import { money } from '../domain/money.js';
import type { AdminDeliverySlotRow } from '../ports/admin-delivery-slot-repository.js';

function toHHMM(date: Date): string {
  return date.toISOString().slice(11, 16);
}

export function toAdminDeliverySlotView(row: AdminDeliverySlotRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    start_time: toHHMM(row.startTime),
    end_time: toHHMM(row.endTime),
    cutoff_time: toHHMM(row.cutoffTime),
    cutoff_days_before: row.cutoffDaysBefore,
    available_days: row.availableDays,
    default_capacity: row.defaultCapacity,
    delivery_fee: row.deliveryFeePaise !== null ? money(Number(row.deliveryFeePaise)) : null,
    min_order_value: row.minOrderValuePaise !== null ? money(Number(row.minOrderValuePaise)) : null,
    is_active: row.isActive,
    display_order: row.displayOrder,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
