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
import type { OrderAssignmentRepository } from '../ports/order-assignment-repository.js';
import type {
  OrderListFilter,
  OrderRepository,
  OrderRow,
  TransitionInput,
} from '../ports/order-repository.js';
import { DeliveryFulfilmentService } from './delivery-fulfilment-service.js';

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');
const PARTNER_ID = '0193dddd-0000-7000-8000-000000000001';
const OTHER_PARTNER_ID = '0193dddd-0000-7000-8000-000000000002';
const ORDER_ID = '0193cccc-0000-7000-8000-000000000001';

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
    assignedPartnerId: PARTNER_ID,
    assignedPartnerName: 'Partner One',
    assignedAt: now(),
    ...overrides,
  };
}

class FakeOrderRepository implements OrderRepository {
  orders = new Map<string, OrderRow>();
  transitionCalls: TransitionInput[] = [];
  codCalls: Array<{ orderId: string; amountPaise: bigint; collectedByUserId: string }> = [];

  async listForCustomer(): Promise<never> {
    throw new Error('not used');
  }
  async getForCustomer(): Promise<never> {
    throw new Error('not used');
  }
  async listForAdmin(): Promise<never> {
    throw new Error('not used');
  }
  async getForAdmin(): Promise<never> {
    throw new Error('not used');
  }
  async listForPartner(
    _scope: BusinessScope,
    partnerAdminUserId: string,
    _filter: OrderListFilter,
  ) {
    const data = [...this.orders.values()].filter(
      (o) => o.assignedPartnerId === partnerAdminUserId,
    );
    return { data, pagination: { limit: 20, next_cursor: null, has_more: false } };
  }
  async getForPartner(
    _scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
  ): Promise<OrderRow | null> {
    const order = this.orders.get(orderId);
    return order && order.assignedPartnerId === partnerAdminUserId ? order : null;
  }
  async transition(
    _scope: BusinessScope,
    orderId: string,
    input: TransitionInput,
  ): Promise<OrderRow> {
    this.transitionCalls.push(input);
    const existing = this.orders.get(orderId);
    if (!existing) throw new Error('not found');
    const updated = {
      ...existing,
      status: input.toStatus,
      cancellationReason: input.reason ?? existing.cancellationReason,
    };
    this.orders.set(orderId, updated);
    return updated;
  }
  async addInternalNote(): Promise<never> {
    throw new Error('not used');
  }
  async recordCodCollection(
    _scope: BusinessScope,
    orderId: string,
    amountPaise: bigint,
    collectedByUserId: string,
  ): Promise<OrderRow> {
    this.codCalls.push({ orderId, amountPaise, collectedByUserId });
    const existing = this.orders.get(orderId);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, paymentStatus: 'PAID' as const };
    this.orders.set(orderId, updated);
    return updated;
  }
}

function partnerRow(overrides: Partial<DeliveryPartnerRow> = {}): DeliveryPartnerRow {
  return {
    adminUserId: PARTNER_ID,
    fullName: 'Partner One',
    email: 'partner@example.test',
    employeeCode: null,
    dutyStatus: 'OFF_DUTY',
    dutyChangedAt: null,
    vehicleType: null,
    vehicleNumber: null,
    deactivated: false,
    activeDeliveryCount: 0,
    ...overrides,
  };
}

class FakeDeliveryPartnerRepository implements DeliveryPartnerRepository {
  partners = new Map<string, DeliveryPartnerRow>();
  setDutyCalls: Array<{ adminUserId: string; dutyStatus: string }> = [];

  async list(_scope: BusinessScope, _filter: DeliveryPartnerListFilter) {
    return [...this.partners.values()];
  }
  async findByAdminUserId(_scope: BusinessScope, adminUserId: string) {
    return this.partners.get(adminUserId) ?? null;
  }
  async createProfile(
    _scope: BusinessScope,
    adminUserId: string,
    _input: CreateDeliveryPartnerProfileInput,
  ) {
    const row = partnerRow({ adminUserId });
    this.partners.set(adminUserId, row);
    return row;
  }
  async setDutyStatus(
    _scope: BusinessScope,
    adminUserId: string,
    dutyStatus: 'ON_DUTY' | 'OFF_DUTY',
  ) {
    this.setDutyCalls.push({ adminUserId, dutyStatus });
    const existing = this.partners.get(adminUserId);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, dutyStatus, dutyChangedAt: now() };
    this.partners.set(adminUserId, updated);
    return updated;
  }
}

class FakeOrderAssignmentRepository implements OrderAssignmentRepository {
  closeActiveCalls: Array<{ orderId: string; status: string }> = [];

  async assign(): Promise<never> {
    throw new Error('not used');
  }
  async closeActive(_scope: BusinessScope, orderId: string, status: 'COMPLETED' | 'CANCELLED') {
    this.closeActiveCalls.push({ orderId, status });
  }
  async getActiveForOrder(): Promise<null> {
    return null;
  }
  async listHistoryForOrder(): Promise<never[]> {
    return [];
  }
  async countActiveForPartner(): Promise<number> {
    return 0;
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

describe('DeliveryFulfilmentService', () => {
  let orders: FakeOrderRepository;
  let partners: FakeDeliveryPartnerRepository;
  let assignments: FakeOrderAssignmentRepository;
  let audit: FakeAuditLog;
  let service: DeliveryFulfilmentService;

  beforeEach(() => {
    orders = new FakeOrderRepository();
    partners = new FakeDeliveryPartnerRepository();
    assignments = new FakeOrderAssignmentRepository();
    audit = new FakeAuditLog();
    service = new DeliveryFulfilmentService({ orders, assignments, partners, audit });

    orders.orders.set(ORDER_ID, orderRow());
    partners.partners.set(PARTNER_ID, partnerRow());
  });

  it('refuses to act on an order not assigned to the calling partner (never leaks existence)', async () => {
    await expect(
      service.getMyDelivery(BUSINESS_ID, OTHER_PARTNER_ID, ORDER_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.acceptAndDispatch(BUSINESS_ID, OTHER_PARTNER_ID, ORDER_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('accepts and dispatches an assigned order (READY_FOR_DISPATCH → OUT_FOR_DELIVERY)', async () => {
    const result = await service.acceptAndDispatch(BUSINESS_ID, PARTNER_ID, ORDER_ID);
    expect(result.status).toBe('OUT_FOR_DELIVERY');
    expect(orders.transitionCalls[0]?.actor).toBe('DELIVERY_PARTNER');
  });

  it('refuses an invalid transition (cannot deliver before dispatch)', async () => {
    await expect(service.markDelivered(BUSINESS_ID, PARTNER_ID, ORDER_ID)).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
  });

  it('marking delivered closes the active assignment', async () => {
    orders.orders.set(ORDER_ID, orderRow({ status: 'OUT_FOR_DELIVERY' }));
    await service.markDelivered(BUSINESS_ID, PARTNER_ID, ORDER_ID);
    expect(assignments.closeActiveCalls).toEqual([{ orderId: ORDER_ID, status: 'COMPLETED' }]);
  });

  it('requires a reason to mark a delivery failed', async () => {
    orders.orders.set(ORDER_ID, orderRow({ status: 'OUT_FOR_DELIVERY' }));
    await expect(service.markFailed(BUSINESS_ID, PARTNER_ID, ORDER_ID, '')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const result = await service.markFailed(
      BUSINESS_ID,
      PARTNER_ID,
      ORDER_ID,
      'Customer not reachable',
    );
    expect(result.status).toBe('FAILED');
  });

  it('records COD collection for an assigned COD order', async () => {
    const result = await service.recordCodCollection(BUSINESS_ID, PARTNER_ID, ORDER_ID, 10000n);
    expect(result.cod_collected).toBe(true);
    expect(audit.events.map((e) => e.action)).toContain('delivery.cod_collected');
  });

  it('refuses a second COD collection on the same order', async () => {
    await service.recordCodCollection(BUSINESS_ID, PARTNER_ID, ORDER_ID, 10000n);
    await expect(
      service.recordCodCollection(BUSINESS_ID, PARTNER_ID, ORDER_ID, 10000n),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses COD collection on a non-COD order', async () => {
    orders.orders.set(ORDER_ID, orderRow({ paymentMethod: 'ONLINE' }));
    await expect(
      service.recordCodCollection(BUSINESS_ID, PARTNER_ID, ORDER_ID, 10000n),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('toggles duty status', async () => {
    const updated = await service.setDutyStatus(BUSINESS_ID, PARTNER_ID, 'ON_DUTY');
    expect(updated.dutyStatus).toBe('ON_DUTY');
    expect(audit.events.map((e) => e.action)).toContain('delivery_partner.duty_status_changed');
  });

  it("computes dashboard counts from the partner's assigned orders", async () => {
    orders.orders.set('order-2', orderRow({ id: 'order-2', status: 'OUT_FOR_DELIVERY' }));
    orders.orders.set(
      'order-3',
      orderRow({
        id: 'order-3',
        status: 'DELIVERED',
        serviceDate: now(),
      }),
    );

    const dashboard = await service.getDashboard(BUSINESS_ID, PARTNER_ID);
    expect(dashboard.assigned_count).toBe(3);
    expect(dashboard.active_count).toBe(2);
    expect(dashboard.completed_today_count).toBe(1);
  });
});
