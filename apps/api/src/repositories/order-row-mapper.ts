import {
  now,
  type OrderAddressSnapshot,
  type OrderItemRow,
  type OrderRow,
} from '@healthy-aahar/core';
import type { Prisma } from '@healthy-aahar/db';

export const ORDER_INCLUDE = {
  items: true,
} satisfies Prisma.OrderInclude;

export type RawOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function isAddressSnapshot(
  value: Prisma.JsonValue,
): value is OrderAddressSnapshot & Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The one place a Prisma `Order` (+ items) row becomes the core `OrderRow`. */
export function toOrderRow(raw: RawOrder): OrderRow {
  const addressSnapshot = isAddressSnapshot(raw.addressSnapshot)
    ? (raw.addressSnapshot as unknown as OrderAddressSnapshot)
    : {
        recipientName: raw.customerNameSnapshot,
        recipientPhone: raw.customerPhoneSnapshot,
        line1: '',
        line2: null,
        landmark: null,
        city: '',
        state: '',
        pincode: '',
      };

  const items: OrderItemRow[] = raw.items.map((item) => ({
    id: item.id,
    productName: item.productNameSnapshot,
    variantName: item.variantNameSnapshot,
    imageUrl: item.imageUrlSnapshot,
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
    lineTotalPaise: item.lineTotalPaise,
  }));

  return {
    id: raw.id,
    businessId: raw.businessId,
    customerProfileId: raw.customerProfileId,
    orderNumber: raw.orderNumber,
    status: raw.status,
    paymentMethod: raw.paymentMethod,
    paymentStatus: raw.paymentStatus,
    customerNameSnapshot: raw.customerNameSnapshot,
    customerPhoneSnapshot: raw.customerPhoneSnapshot,
    items,
    subtotalPaise: raw.subtotalPaise,
    discountPaise: raw.discountPaise,
    deliveryFeePaise: raw.deliveryFeePaise,
    taxPaise: raw.taxPaise,
    totalPaise: raw.totalPaise,
    addressSnapshot,
    serviceDate: raw.serviceDate,
    slotNameSnapshot: raw.slotNameSnapshot,
    customerNote: raw.customerNote,
    internalNote: raw.internalNote,
    cancelledByType: raw.cancelledByType,
    cancellationReason: raw.cancellationReason,
    placedAt: raw.placedAt,
    confirmedAt: raw.confirmedAt,
    updatedAt: raw.updatedAt,
  };
}

/** `ORD-YYYYMMDD-XXXXXX`. Readable for support, opaque enough it cannot be
 *  guessed sequentially. A dedicated sequence is future work if volume needs it. */
export function generateOrderNumber(): string {
  const datePart = now().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}
