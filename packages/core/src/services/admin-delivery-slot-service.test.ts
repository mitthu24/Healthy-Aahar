import { describe, expect, it } from 'vitest';

import { businessScope, type BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AuditEvent, AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  AdminDeliverySlotRepository,
  AdminDeliverySlotRow,
  DeliverySlotInput,
  DeliverySlotUpdateInput,
} from '../ports/admin-delivery-slot-repository.js';
import { AdminDeliverySlotService } from './admin-delivery-slot-service.js';

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');

function time(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

function row(overrides: Partial<AdminDeliverySlotRow> = {}): AdminDeliverySlotRow {
  return {
    id: '0193bbbb-0000-7000-8000-000000000001',
    businessId: BUSINESS_ID,
    name: 'Morning',
    code: 'morning',
    startTime: time('07:00'),
    endTime: time('08:00'),
    cutoffTime: time('07:00'),
    cutoffDaysBefore: 0,
    availableDays: [1, 2, 3, 4, 5, 6, 7],
    defaultCapacity: 20,
    deliveryFeePaise: null,
    minOrderValuePaise: null,
    isActive: true,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** In-memory repository — same pattern as serviceability-service.test.ts. */
class FakeRepository implements AdminDeliverySlotRepository {
  readonly rows: AdminDeliverySlotRow[];

  constructor(rows: AdminDeliverySlotRow[] = []) {
    this.rows = rows;
  }

  async list(_scope: BusinessScope): Promise<AdminDeliverySlotRow[]> {
    return this.rows;
  }

  async findById(_scope: BusinessScope, id: string): Promise<AdminDeliverySlotRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByCode(_scope: BusinessScope, code: string): Promise<AdminDeliverySlotRow | null> {
    return this.rows.find((r) => r.code === code) ?? null;
  }

  async create(
    _scope: BusinessScope,
    input: DeliverySlotInput,
    _actorUserId: string,
  ): Promise<AdminDeliverySlotRow> {
    const created = row({
      id: `created-${this.rows.length + 1}`,
      name: input.name,
      code: input.code,
      startTime: time(input.startTime),
      endTime: time(input.endTime),
      availableDays: input.availableDays,
      defaultCapacity: input.defaultCapacity,
      displayOrder: input.displayOrder,
    });
    this.rows.push(created);
    return created;
  }

  async update(
    _scope: BusinessScope,
    id: string,
    input: DeliverySlotUpdateInput,
    _actorUserId: string,
  ): Promise<AdminDeliverySlotRow> {
    const existing = this.rows.find((r) => r.id === id);
    if (!existing) throw new DomainError('NOT_FOUND', 'Delivery slot not found.');
    const updated: AdminDeliverySlotRow = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startTime !== undefined ? { startTime: time(input.startTime) } : {}),
      ...(input.endTime !== undefined ? { endTime: time(input.endTime) } : {}),
      ...(input.defaultCapacity !== undefined ? { defaultCapacity: input.defaultCapacity } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const i = this.rows.indexOf(existing);
    this.rows[i] = updated;
    return updated;
  }
}

class FakeAuditLog implements AuditLogRepository {
  readonly events: AuditEvent[] = [];
  async write(_scope: BusinessScope, event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function service(rows: AdminDeliverySlotRow[] = []) {
  const slots = new FakeRepository(rows);
  const audit = new FakeAuditLog();
  return { service: new AdminDeliverySlotService({ slots, audit }), slots, audit };
}

const VALID_INPUT: DeliverySlotInput = {
  name: 'Evening',
  code: 'evening',
  startTime: '18:00',
  endTime: '19:00',
  cutoffDaysBefore: 0,
  availableDays: [1, 2, 3, 4, 5, 6, 7],
  defaultCapacity: 20,
  displayOrder: 1,
};

describe('AdminDeliverySlotService', () => {
  it('creates a slot and writes an audit event', async () => {
    const { service: svc, audit } = service();
    const created = await svc.create(BUSINESS_ID, VALID_INPUT, 'actor-1');

    expect(created.name).toBe('Evening');
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toBe('delivery_slot.created');
  });

  it('rejects a start time that is not before the end time', async () => {
    const { service: svc } = service();
    await expect(
      svc.create(BUSINESS_ID, { ...VALID_INPUT, startTime: '19:00', endTime: '18:00' }, 'actor-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects equal start and end times', async () => {
    const { service: svc } = service();
    await expect(
      svc.create(BUSINESS_ID, { ...VALID_INPUT, startTime: '18:00', endTime: '18:00' }, 'actor-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects creating a slot whose code is already in use', async () => {
    const existing = row({ code: 'evening' });
    const { service: svc } = service([existing]);

    await expect(svc.create(BUSINESS_ID, VALID_INPUT, 'actor-1')).rejects.toMatchObject({
      code: 'SLUG_ALREADY_IN_USE',
    });
  });

  it('updating only the capacity keeps the existing time range valid', async () => {
    const existing = row();
    const { service: svc } = service([existing]);

    const updated = await svc.update(BUSINESS_ID, existing.id, { defaultCapacity: 5 }, 'actor-1');
    expect(updated.defaultCapacity).toBe(5);
  });

  it('rejects an update that would make start time not-before end time', async () => {
    const existing = row();
    const { service: svc } = service([existing]);

    await expect(
      svc.update(BUSINESS_ID, existing.id, { startTime: '09:00' }, 'actor-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('activating/deactivating writes a status_changed audit event, not a generic update', async () => {
    const existing = row({ isActive: true });
    const { service: svc, audit } = service([existing]);

    await svc.update(BUSINESS_ID, existing.id, { isActive: false }, 'actor-1');
    expect(audit.events[0]?.action).toBe('delivery_slot.status_changed');
  });

  it('throws NOT_FOUND for an unknown slot id', async () => {
    const { service: svc } = service([]);
    await expect(svc.get(BUSINESS_ID, 'missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
