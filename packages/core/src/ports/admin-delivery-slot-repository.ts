import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Admin delivery-slot management (Phase 04 — delivery-slot-only; see
 * docs/PHASE-04-STOREFRONT-IMPLEMENTATION-REPORT.md §15 for why there is no
 * zone port alongside this one).
 */
export type AdminDeliverySlotRow = {
  id: string;
  businessId: string;
  name: string;
  code: string;
  startTime: Date;
  endTime: Date;
  cutoffTime: Date;
  cutoffDaysBefore: number;
  availableDays: number[];
  defaultCapacity: number;
  deliveryFeePaise: bigint | null;
  minOrderValuePaise: bigint | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DeliverySlotInput = {
  name: string;
  code: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  cutoffTime?: string | undefined;
  cutoffDaysBefore: number;
  availableDays: number[];
  defaultCapacity: number;
  deliveryFeePaise?: number | undefined;
  minOrderValuePaise?: number | undefined;
  displayOrder: number;
};

export type DeliverySlotUpdateInput = Partial<{
  name: string;
  startTime: string;
  endTime: string;
  cutoffTime: string;
  cutoffDaysBefore: number;
  availableDays: number[];
  defaultCapacity: number;
  deliveryFeePaise: number | null;
  minOrderValuePaise: number | null;
  displayOrder: number;
  isActive: boolean;
}>;

export interface AdminDeliverySlotRepository {
  list(scope: BusinessScope): Promise<AdminDeliverySlotRow[]>;
  findById(scope: BusinessScope, id: string): Promise<AdminDeliverySlotRow | null>;
  findByCode(scope: BusinessScope, code: string): Promise<AdminDeliverySlotRow | null>;
  create(
    scope: BusinessScope,
    input: DeliverySlotInput,
    actorUserId: string,
  ): Promise<AdminDeliverySlotRow>;
  update(
    scope: BusinessScope,
    id: string,
    input: DeliverySlotUpdateInput,
    actorUserId: string,
  ): Promise<AdminDeliverySlotRow>;
}
