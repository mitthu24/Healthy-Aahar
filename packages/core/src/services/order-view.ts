import { customerDisplayStatus } from '../domain/order-status.js';
import { money } from '../domain/money.js';
import type { OrderRow } from '../ports/order-repository.js';

/** Shared OrderRow -> API view mapping, used by checkout, customer orders and admin orders. */
export function toOrderView(order: OrderRow) {
  const items = order.items.map((item) => ({
    id: item.id,
    product_name: item.productName,
    variant_name: item.variantName,
    image_url: item.imageUrl,
    quantity: item.quantity,
    unit_price: money(Number(item.unitPricePaise)),
    line_total: money(Number(item.lineTotalPaise)),
  }));

  return {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    display_status: customerDisplayStatus(order.status, order.cancelledByType),
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    items,
    subtotal: money(Number(order.subtotalPaise)),
    delivery_fee: money(Number(order.deliveryFeePaise)),
    discount: money(Number(order.discountPaise)),
    tax: money(Number(order.taxPaise)),
    total: money(Number(order.totalPaise)),
    delivery_address: order.addressSnapshot,
    service_date: order.serviceDate.toISOString().slice(0, 10),
    slot_name: order.slotNameSnapshot,
    customer_note: order.customerNote,
    cancellation_reason: order.cancellationReason,
    placed_at: order.placedAt.toISOString(),
    confirmed_at: order.confirmedAt?.toISOString() ?? null,
  };
}

export function toAdminOrderView(order: OrderRow) {
  const items = order.items.map((item) => ({
    id: item.id,
    product_name: item.productName,
    variant_name: item.variantName,
    image_url: item.imageUrl,
    quantity: item.quantity,
    unit_price: money(Number(item.unitPricePaise)),
    line_total: money(Number(item.lineTotalPaise)),
  }));

  return {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    customer_name: order.customerNameSnapshot,
    customer_phone: order.customerPhoneSnapshot,
    items,
    total: money(Number(order.totalPaise)),
    delivery_address: order.addressSnapshot,
    service_date: order.serviceDate.toISOString().slice(0, 10),
    slot_name: order.slotNameSnapshot,
    internal_note: order.internalNote,
    cancelled_by_type: order.cancelledByType,
    cancellation_reason: order.cancellationReason,
    placed_at: order.placedAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
