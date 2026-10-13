import { beforeEach, describe, expect, it } from 'vitest';

import { businessScope } from '../domain/business-scope.js';
import type { BusinessScope } from '../domain/business-scope.js';
import { now } from '../domain/time.js';
import type { AuditEvent, AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  CreateDeliveryPartnerProfileInput,
  DeliveryPartnerListFilter,
  DeliveryPartnerRepository,
  DeliveryPartnerRow,
} from '../ports/delivery-partner-repository.js';
import type {
  CreateAssignmentInput,
  OrderAssignmentRepository,
  OrderAssignmentRow,
} from '../ports/order-assignment-repository.js';
import type { OrderRepository, OrderRow } from '../ports/order-repository.js';
import { OrderAssignmentService } from './order-assignment-service.js';

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');
const ACTOR_USER_ID = '0193bbbb-0000-7000-8000-000000000001';
const ORDER_ID = '0193cccc-0000-7000-8000-000000000001';
const PARTNER_ID = '0193dddd-0000-7000-8000-000000000001';

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    businessId: BUSINESS_ID,
    customerProfileId: '0193eeee-0000-7000-8000-000000000001',
    orderNumber: 'ORD-20261013-AAAAAA',
    status: 'READY_FOR_DISPATCH',
    statusHistory: [],
    paymentMethod: 'COD',
    paymentStatus: 'DUE',
    customerNameSnapshot: 'Jane Customer',
    customerPhoneSnapshot: '+919876543210',
    items: [],
    subtotalPaise: 10000n,
    discountPaise: 0n,
    deliveryFeePaise: 0n,
    taxPaise: 0n,
    totalPaise: 10000n,
    addressSnapshot: {
      recipientName: 'Jane Customer',
      recipientPhone: '+919876543210',
      line1: '1 Main St',
      line2: null,
      landmark: null,
      city: 'Noida',
      state: 'UP',
      pincode: '201301',
    },
    serviceDate: now(),
    slotNameSnapshot: 'Morning',
    customerNote: null,
    internalNote: null,
    cancelledByType: null,
    cancellationReason: null,
    placedAt: now(),
    confirmedAt: now(),
    updatedAt: now(),
    assignedPartnerId: null,
    assignedPartnerName: null,
    assignedAt: null,
    ...overrides,
  };
}

function partnerRow(overrides: Partial<DeliveryPartnerRow> = {}): DeliveryPartnerRow {
  return {
    adminUserId: PARTNER_ID,
    fullName: 'Partner One',
    email: 'partner@example.test',
    employeeCode: null,
    dutyStatus: 'ON_DUTY',
    dutyChangedAt: now(),
    vehicleType: null,
    vehicleNumber: null,
    deactivated: false,
    activeDeliveryCount: 0,
    ...overrides,
  };
}

class FakeOrderRepository implements OrderRepository {
  orders = new Map<string, OrderRow>();

  async listForCustomer(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async getForCustomer(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async listForAdmin(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async getForAdmin(_scope: BusinessScope, orderId: string): Promise<OrderRow | null> {
    return this.orders.get(orderId) ?? null;
  }
  async listForPartner(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async getForPartner(
    _scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
  ): Promise<OrderRow | null> {
    const order = this.orders.get(orderId);
    return order && order.assignedPartnerId === partnerAdminUserId ? order : null;
  }
  async transition(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async addInternalNote(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async recordCodCollection(): Promise<never> {
    throw new Error('not used in these tests');
  }
}

class FakeDeliveryPartnerRepository implements DeliveryPartnerRepository {
  partners = new Map<string, DeliveryPartnerRow>();

  async list(
    _scope: BusinessScope,
    filter: DeliveryPartnerListFilter,
  ): Promise<DeliveryPartnerRow[]> {
    return [...this.partners.values()].filter(
      (p) => !filter.dutyStatus || p.dutyStatus === filter.dutyStatus,
    );
  }
  async findByAdminUserId(
    _scope: BusinessScope,
    adminUserId: string,
  ): Promise<DeliveryPartnerRow | null> {
    return this.partners.get(adminUserId) ?? null;
  }
  async createProfile(
    _scope: BusinessScope,
    adminUserId: string,
    input: CreateDeliveryPartnerProfileInput,
  ): Promise<DeliveryPartnerRow> {
    const row = partnerRow({
      adminUserId,
      vehicleType: input.vehicleType ?? null,
      vehicleNumber: input.vehicleNumber ?? null,
    });
    this.partners.set(adminUserId, row);
    return row;
  }
  async setDutyStatus(): Promise<never> {
    throw new Error('not used in these tests');
  }
}

class FakeOrderAssignmentRepository implements OrderAssignmentRepository {
  assignCalls: CreateAssignmentInput[] = [];
  rows: OrderAssignmentRow[] = [];

  async assign(_scope: BusinessScope, input: CreateAssignmentInput): Promise<OrderAssignmentRow> {
    this.assignCalls.push(input);
    const row: OrderAssignmentRow = {
      id: `assignment-${this.rows.length + 1}`,
      orderId: input.orderId,
      partnerAdminUserId: input.partnerAdminUserId,
      partnerName: 'Partner One',
      assignedByUserId: input.assignedByUserId,
      status: 'ACTIVE',
      reason: input.reason ?? null,
      assignedAt: now(),
      endedAt: null,
    };
    this.rows.push(row);
    return row;
  }
  async closeActive(): Promise<void> {}
  async getActiveForOrder(): Promise<OrderAssignmentRow | null> {
    return this.rows.find((r) => r.status === 'ACTIVE') ?? null;
  }
  async listHistoryForOrder(): Promise<OrderAssignmentRow[]> {
    return this.rows;
  }
  async countActiveForPartner(): Promise<number> {
    return this.rows.filter((r) => r.status === 'ACTIVE').length;
  }
}

class FakeAuditLog implements AuditLogRepository {
  events: AuditEvent[] = [];
  async write(_scope: BusinessScope, event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async list(): Promise<never[]> {
    return [];
  }
}

describe('OrderAssignmentService', () => {
  let orders: FakeOrderRepository;
  let partners: FakeDeliveryPartnerRepository;
  let assignments: FakeOrderAssignmentRepository;
  let audit: FakeAuditLog;
  let service: OrderAssignmentService;

  beforeEach(() => {
    orders = new FakeOrderRepository();
    partners = new FakeDeliveryPartnerRepository();
    assignments = new FakeOrderAssignmentRepository();
    audit = new FakeAuditLog();
    service = new OrderAssignmentService({ orders, assignments, partners, audit });

    orders.orders.set(ORDER_ID, orderRow());
    partners.partners.set(PARTNER_ID, partnerRow());
  });

  it('assigns an order to an on-duty partner', async () => {
    await service.assign(BUSINESS_ID, {
      orderId: ORDER_ID,
      partnerAdminUserId: PARTNER_ID,
      actorUserId: ACTOR_USER_ID,
    });

    expect(assignments.assignCalls).toHaveLength(1);
    expect(audit.events.map((e) => e.action)).toContain('order.assigned');
  });

  it('refuses to assign to an off-duty partner', async () => {
    partners.partners.set(PARTNER_ID, partnerRow({ dutyStatus: 'OFF_DUTY' }));

    await expect(
      service.assign(BUSINESS_ID, {
        orderId: ORDER_ID,
        partnerAdminUserId: PARTNER_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_OFF_DUTY' });
    expect(assignments.assignCalls).toHaveLength(0);
  });

  it('refuses to assign to a suspended partner', async () => {
    partners.partners.set(PARTNER_ID, partnerRow({ deactivated: true }));

    await expect(
      service.assign(BUSINESS_ID, {
        orderId: ORDER_ID,
        partnerAdminUserId: PARTNER_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND' });
  });

  it('refuses to assign an order that is not in an assignable status', async () => {
    orders.orders.set(ORDER_ID, orderRow({ status: 'DELIVERED' }));

    await expect(
      service.assign(BUSINESS_ID, {
        orderId: ORDER_ID,
        partnerAdminUserId: PARTNER_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_ASSIGNABLE' });
  });

  it('requires a reason to reassign an already-assigned order', async () => {
    orders.orders.set(ORDER_ID, orderRow({ assignedPartnerId: 'some-other-partner' }));

    await expect(
      service.assign(BUSINESS_ID, {
        orderId: ORDER_ID,
        partnerAdminUserId: PARTNER_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await service.assign(BUSINESS_ID, {
      orderId: ORDER_ID,
      partnerAdminUserId: PARTNER_ID,
      actorUserId: ACTOR_USER_ID,
      reason: 'Original partner called in sick',
    });
    expect(assignments.assignCalls).toHaveLength(1);
    expect(audit.events.map((e) => e.action)).toContain('order.reassigned');
  });

  it('404s for a nonexistent order', async () => {
    await expect(
      service.assign(BUSINESS_ID, {
        orderId: 'does-not-exist',
        partnerAdminUserId: PARTNER_ID,
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists only on-duty, non-suspended partners as eligible', async () => {
    partners.partners.set(
      'off-duty-partner',
      partnerRow({ adminUserId: 'off-duty-partner', dutyStatus: 'OFF_DUTY' }),
    );
    partners.partners.set(
      'suspended-partner',
      partnerRow({ adminUserId: 'suspended-partner', deactivated: true }),
    );

    const eligible = await service.listEligiblePartners(BUSINESS_ID);
    expect(eligible.map((p) => p.adminUserId)).toEqual([PARTNER_ID]);
  });
});
