import {
  DomainError,
  canTransition,
  newId,
  now,
  type BusinessScope,
  type CheckoutRepository,
  type OrderRow,
  type PlaceOrderInput,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

import { isUniqueConstraintViolation } from './prisma-errors.js';
import { ORDER_INCLUDE, generateOrderNumber, toOrderRow } from './order-row-mapper.js';

const ENDPOINT = 'POST /v1/me/orders';
const IDEMPOTENCY_KEY_TTL_HOURS = 24;

/**
 * Checkout (docs/09 §4, docs/19 §2-3; Phase 04 requirement change).
 *
 * `placeOrder` does everything inside ONE `$transaction`: it re-fetches the
 * cart, address and every variant live, reserves inventory with a
 * conditional `UPDATE ... WHERE quantity_on_hand - quantity_reserved >=
 * qty` (the same lost-update-safe pattern PHASE 03 used for session token
 * consumption — no row lock needed, a 0-row update IS the stock-check
 * failure), creates the order/items/payment, and immediately transitions
 * PENDING -> CONFIRMED via the existing SYSTEM-actor rule in
 * `ORDER_TRANSITIONS`. Any thrown error rolls back the whole transaction:
 * no partial order, no phantom reservation (requirement 3).
 *
 * Idempotency: the `IdempotencyKey` row is created as the FIRST statement
 * inside the transaction. A repeat request with the same key races on that
 * row's unique `(user_id, endpoint, key)` index — Postgres resolves the
 * race, Prisma surfaces it as a P2002 the transaction aborts on, and the
 * catch block below looks up the real row to decide whether to return the
 * original order or a clear conflict (requirement 4, 9, 12).
 */
export class PrismaCheckoutRepository implements CheckoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async placeOrder(scope: BusinessScope, input: PlaceOrderInput): Promise<OrderRow> {
    const {
      customerProfileId,
      addressId,
      deliverySlotId,
      serviceDate,
      idempotencyKey,
      requestHash,
    } = input;
    // `scope` is the trusted business id; `input.businessId` is caller-supplied
    // and must agree with it (defence in depth, ADR-005).
    const businessId: string = scope;

    const customerProfile = await this.prisma.customerProfile.findFirst({
      where: { id: customerProfileId, businessId },
      include: { user: { select: { id: true, phone: true } } },
    });
    if (!customerProfile) throw new DomainError('NOT_FOUND', 'Customer profile not found.');
    const userId = customerProfile.user.id;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyKey.create({
          data: {
            id: newId(),
            userId,
            endpoint: ENDPOINT,
            key: idempotencyKey,
            requestHash,
            status: 'IN_PROGRESS',
            expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000),
          },
        });

        const cart = await tx.cart.findUnique({
          where: { customerProfileId },
          include: { items: true },
        });
        if (!cart || cart.items.length === 0) {
          throw new DomainError('CART_EMPTY', 'Your cart is empty.');
        }

        const address = await tx.address.findFirst({
          where: { id: addressId, customerProfileId, deletedAt: null },
        });
        if (!address) throw new DomainError('NOT_FOUND', 'Address not found.');

        // Delivery-slot-only checkout (Phase 04): no DeliveryZone is
        // resolved or required here. PHASE 06 owns real zone/capacity
        // management; it was never built, so requiring one made checkout
        // impossible in every environment. This is NOT a pincode allowlist
        // — any address belonging to the customer is accepted; the only
        // gate is the slot itself (active, offered on this day, has room).
        const slot = await tx.deliverySlot.findFirst({
          where: { id: deliverySlotId, businessId, isActive: true, deletedAt: null },
        });
        if (!slot) throw new DomainError('NOT_FOUND', 'Delivery slot not found.');

        const serviceDateObj = new Date(serviceDate);
        const isoWeekday = ((serviceDateObj.getUTCDay() + 6) % 7) + 1; // JS 0=Sun -> ISO 1=Mon..7=Sun
        if (!slot.availableDays.includes(isoWeekday)) {
          throw new DomainError(
            'SLOT_NOT_AVAILABLE_ON_DAY',
            `${slot.name} is not offered on the selected date.`,
          );
        }

        // Advisory lock keyed by (slot, date) serialises concurrent
        // checkouts for the SAME slot+date within this transaction, so the
        // booked-count read below cannot race with another request's
        // insert — the same concurrency-safety goal the inventory
        // conditional UPDATE achieves for stock, applied here because a
        // slot's capacity has no row of its own to condition an UPDATE on.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${slot.id} || ${serviceDate}))`;

        const bookedCount = await tx.order.count({
          where: {
            deliverySlotId: slot.id,
            serviceDate: serviceDateObj,
            status: { notIn: ['CANCELLED', 'FAILED'] },
          },
        });
        if (bookedCount >= slot.defaultCapacity) {
          throw new DomainError(
            'SLOT_CAPACITY_EXCEEDED',
            `${slot.name} is fully booked for the selected date. Please choose another slot or date.`,
          );
        }

        const orderId = newId();
        let subtotalPaise = 0n;
        let taxPaise = 0n;
        const itemsData: Array<{
          variantId: string;
          productNameSnapshot: string;
          variantNameSnapshot: string;
          skuSnapshot: string;
          imageUrlSnapshot: string | null;
          unit: string;
          unitValue: unknown;
          quantity: number;
          unitPricePaise: bigint;
          mrpPaise: bigint | null;
          taxRateBps: number;
          taxPaise: bigint;
          lineTotalPaise: bigint;
        }> = [];

        for (const cartItem of cart.items) {
          if (!cartItem.variantId) continue; // combos are a later phase

          // Lock the variant row before re-reading it: an admin's delete
          // (Stage E, `deleteIfUnreferenced`) locks this same row before
          // deciding whether it's referenced, so whichever of the two
          // operations reaches this row first forces the other to wait and
          // then act on committed data — the admin's delete sees this item
          // once we commit (and correctly refuses with
          // VARIANT_REFERENCED_BY_ORDERS), or we see `deleted_at` once the
          // admin's delete commits (and correctly refuse below with
          // ITEM_NOT_AVAILABLE) instead of either side racing past the
          // other.
          await tx.$queryRaw`
            SELECT id FROM product_variants
            WHERE id = ${cartItem.variantId}::uuid AND business_id = ${businessId}::uuid
            FOR UPDATE
          `;

          // Re-read live — never trust the cart's cached join for price/stock.
          const variant = await tx.productVariant.findFirst({
            where: { id: cartItem.variantId, businessId, deletedAt: null },
            include: {
              product: {
                select: {
                  name: true,
                  images: { where: { variantId: null }, take: 1, orderBy: { displayOrder: 'asc' } },
                },
              },
            },
          });
          if (!variant || variant.availability !== 'AVAILABLE') {
            throw new DomainError(
              'ITEM_NOT_AVAILABLE',
              `${variant?.name ?? 'An item'} in your cart is no longer available.`,
            );
          }
          if (variant.maxOrderQuantity !== null && cartItem.quantity > variant.maxOrderQuantity) {
            throw new DomainError(
              'MAX_QUANTITY_EXCEEDED',
              `Only ${variant.maxOrderQuantity} of ${variant.name} may be ordered at once.`,
            );
          }

          const inventory = await tx.inventory.findUnique({
            where: { variantId_locationCode: { variantId: variant.id, locationCode: 'MAIN' } },
          });

          if (inventory && inventory.trackInventory) {
            const updated: number = await tx.$executeRaw`
              UPDATE inventory
              SET quantity_reserved = quantity_reserved + ${cartItem.quantity}, updated_at = now()
              WHERE variant_id = ${variant.id}::uuid AND location_code = 'MAIN'
                AND (allow_backorder = true OR quantity_on_hand - quantity_reserved >= ${cartItem.quantity})
            `;
            if (updated === 0) {
              throw new DomainError(
                'INSUFFICIENT_STOCK',
                `${variant.name} does not have enough stock.`,
              );
            }

            await tx.inventoryMovement.create({
              data: {
                id: newId(),
                inventoryId: inventory.id,
                variantId: variant.id,
                reason: 'ORDER_RESERVED',
                quantityDelta: 0,
                quantityAfter:
                  inventory.quantityOnHand - inventory.quantityReserved - cartItem.quantity,
                reservedDelta: cartItem.quantity,
                referenceType: 'ORDER',
                referenceId: orderId,
                note: 'Reserved at checkout',
              },
            });
          }

          const lineTotalBase = variant.pricePaise * BigInt(cartItem.quantity);
          const lineTax = (lineTotalBase * BigInt(variant.taxRateBps)) / 10_000n;
          subtotalPaise += lineTotalBase;
          taxPaise += lineTax;

          itemsData.push({
            variantId: variant.id,
            productNameSnapshot: variant.product.name,
            variantNameSnapshot: variant.name,
            skuSnapshot: variant.sku,
            imageUrlSnapshot: variant.product.images[0]?.url ?? null,
            unit: variant.unit,
            unitValue: variant.unitValue,
            quantity: cartItem.quantity,
            unitPricePaise: variant.pricePaise,
            mrpPaise: variant.mrpPaise,
            taxRateBps: variant.taxRateBps,
            taxPaise: lineTax,
            lineTotalPaise: lineTotalBase + lineTax,
          });
        }

        if (itemsData.length === 0) {
          throw new DomainError('CART_EMPTY', 'Your cart is empty.');
        }

        // Delivery fee and minimum order value now come from the SLOT
        // (both fields already existed on DeliverySlot — no schema change
        // needed), not a zone.
        const deliveryFeePaise = slot.deliveryFeePaise ?? 0n;
        const totalPaise = subtotalPaise + deliveryFeePaise + taxPaise;

        if (slot.minOrderValuePaise !== null && subtotalPaise < slot.minOrderValuePaise) {
          throw new DomainError(
            'MIN_ORDER_NOT_MET',
            `A minimum order of ${slot.minOrderValuePaise} paise is required for this slot.`,
          );
        }

        const placedAt = now();

        const created = await tx.order.create({
          data: {
            id: orderId,
            businessId,
            orderNumber: generateOrderNumber(),
            customerProfileId,
            status: 'PENDING',
            source: 'ONE_TIME',
            channel: 'WEB',
            deliverySlotId: slot.id,
            serviceDate: new Date(serviceDate),
            slotStartTime: slot.startTime,
            slotEndTime: slot.endTime,
            slotNameSnapshot: slot.name,
            addressId: address.id,
            addressSnapshot: {
              recipientName: address.recipientName,
              recipientPhone: address.recipientPhone,
              line1: address.line1,
              line2: address.line2,
              landmark: address.landmark,
              city: address.city,
              state: address.state,
              pincode: address.pincode,
            },
            customerNameSnapshot: address.recipientName,
            customerPhoneSnapshot: customerProfile.user.phone ?? address.recipientPhone,
            subtotalPaise,
            discountPaise: 0n,
            deliveryFeePaise,
            taxPaise,
            totalPaise,
            paymentMethod: 'COD',
            paymentStatus: 'DUE',
            customerNote: input.customerNote ?? null,
            placedAt,
            items: {
              create: itemsData.map((item) => ({
                id: newId(),
                variantId: item.variantId,
                productNameSnapshot: item.productNameSnapshot,
                variantNameSnapshot: item.variantNameSnapshot,
                skuSnapshot: item.skuSnapshot,
                imageUrlSnapshot: item.imageUrlSnapshot,
                unit: item.unit,
                unitValue: item.unitValue as Prisma.Decimal,
                quantity: item.quantity,
                unitPricePaise: item.unitPricePaise,
                mrpPaise: item.mrpPaise,
                discountPaise: 0n,
                taxRateBps: item.taxRateBps,
                taxPaise: item.taxPaise,
                lineTotalPaise: item.lineTotalPaise,
              })),
            },
          },
          include: ORDER_INCLUDE,
        });

        await tx.payment.create({
          data: {
            id: newId(),
            orderId,
            method: 'COD',
            status: 'DUE',
            amountPaise: totalPaise,
            currency: 'INR',
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            id: newId(),
            orderId,
            fromStatus: null,
            toStatus: 'PENDING',
            actorType: 'SYSTEM',
          },
        });

        // Requirement 1: auto-confirm immediately, using the EXISTING
        // PENDING -> CONFIRMED transition (actor SYSTEM is already allowed
        // for it in packages/core/domain/order-status.ts) — no bypass.
        const check = canTransition('PENDING', 'CONFIRMED', 'SYSTEM');
        if (!check.allowed) {
          throw new DomainError('INTERNAL_ERROR', 'Auto-confirmation transition is not permitted.');
        }

        const confirmedAt = now();
        const confirmed = await tx.order.update({
          where: { id: orderId },
          data: { status: 'CONFIRMED', confirmedAt },
          include: ORDER_INCLUDE,
        });

        await tx.orderStatusHistory.create({
          data: {
            id: newId(),
            orderId,
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            actorType: 'SYSTEM',
          },
        });

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        // In-app notification (requirement 6) — the existing Notification
        // model, no external provider required.
        await tx.notification.create({
          data: {
            id: newId(),
            userId,
            type: 'ORDER_CONFIRMED',
            title: 'Order confirmed',
            body: `Your order ${created.orderNumber} has been confirmed and will be prepared for ${serviceDate}.`,
            actionUrl: `/orders/${orderId}`,
          },
        });

        await tx.idempotencyKey.update({
          where: { userId_endpoint_key: { userId, endpoint: ENDPOINT, key: idempotencyKey } },
          data: { status: 'COMPLETED', resourceId: orderId, responseStatus: 201 },
        });

        return toOrderRow(confirmed);
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, 'key')) {
        return this.handleIdempotencyConflict(userId, idempotencyKey, requestHash);
      }
      throw error;
    }
  }

  private async handleIdempotencyConflict(
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<OrderRow> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { userId_endpoint_key: { userId, endpoint: ENDPOINT, key } },
    });

    if (!existing) {
      // Lost the race but the winner's row is now gone (should not happen
      // outside a crash) — safest answer is "try again", not a silent retry.
      throw new DomainError('IDEMPOTENT_REQUEST_IN_PROGRESS', 'Please retry this request.');
    }

    if (existing.requestHash !== requestHash) {
      throw new DomainError(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with a different request.',
      );
    }

    if (existing.status === 'IN_PROGRESS') {
      throw new DomainError(
        'IDEMPOTENT_REQUEST_IN_PROGRESS',
        'This request is already being processed.',
      );
    }

    if (existing.status === 'COMPLETED' && existing.resourceId) {
      const order = await this.prisma.order.findUnique({
        where: { id: existing.resourceId },
        include: ORDER_INCLUDE,
      });
      if (order) return toOrderRow(order);
    }

    // status === 'FAILED', or COMPLETED with no resourceId: the original
    // attempt did not produce an order. Let the caller retry with a fresh
    // key rather than silently fabricating success.
    throw new DomainError(
      'IDEMPOTENT_REQUEST_IN_PROGRESS',
      'The original request did not complete. Retry with a new idempotency key.',
    );
  }
}
