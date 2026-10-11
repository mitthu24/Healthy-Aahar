import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  AdminDeliverySlotRepository,
  AdminDeliverySlotRow,
  DeliverySlotInput,
  DeliverySlotUpdateInput,
} from '../ports/admin-delivery-slot-repository.js';

export type AdminDeliverySlotServiceDeps = {
  slots: AdminDeliverySlotRepository;
  audit: AuditLogRepository;
};

/**
 * Founder/admin delivery-slot management (Phase 04 — delivery-slot-only;
 * no zone concept here, see the port's own doc comment).
 */
export class AdminDeliverySlotService {
  private readonly slots: AdminDeliverySlotRepository;
  private readonly audit: AuditLogRepository;

  constructor({ slots, audit }: AdminDeliverySlotServiceDeps) {
    this.slots = slots;
    this.audit = audit;
  }

  list(scope: BusinessScope): Promise<AdminDeliverySlotRow[]> {
    return this.slots.list(scope);
  }

  async get(scope: BusinessScope, id: string): Promise<AdminDeliverySlotRow> {
    const slot = await this.slots.findById(scope, id);
    if (!slot) throw new DomainError('NOT_FOUND', 'Delivery slot not found.');
    return slot;
  }

  async create(
    scope: BusinessScope,
    input: DeliverySlotInput,
    actorUserId: string,
  ): Promise<AdminDeliverySlotRow> {
    this.assertValidRange(input.startTime, input.endTime);

    const existing = await this.slots.findByCode(scope, input.code);
    if (existing) {
      throw new DomainError(
        'SLUG_ALREADY_IN_USE',
        'A delivery slot with this code already exists.',
        {
          details: [{ field: 'code', issue: 'already in use' }],
        },
      );
    }

    const created = await this.slots.create(scope, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'delivery_slot.created',
      resourceType: 'delivery_slot',
      resourceId: created.id,
      metadata: {
        name: created.name,
        code: created.code,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    });

    return created;
  }

  async update(
    scope: BusinessScope,
    id: string,
    input: DeliverySlotUpdateInput,
    actorUserId: string,
  ): Promise<AdminDeliverySlotRow> {
    const existing = await this.get(scope, id);

    const nextStart = input.startTime ?? this.toHHMM(existing.startTime);
    const nextEnd = input.endTime ?? this.toHHMM(existing.endTime);
    this.assertValidRange(nextStart, nextEnd);

    const updated = await this.slots.update(scope, id, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action:
        input.isActive !== undefined ? 'delivery_slot.status_changed' : 'delivery_slot.updated',
      resourceType: 'delivery_slot',
      resourceId: id,
      metadata: input,
    });

    return updated;
  }

  private assertValidRange(startTime: string, endTime: string): void {
    if (startTime >= endTime) {
      throw new DomainError('VALIDATION_FAILED', 'Start time must be before end time.', {
        details: [{ field: 'end_time', issue: 'must be after start_time' }],
      });
    }
  }

  private toHHMM(date: Date): string {
    return date.toISOString().slice(11, 16);
  }
}
