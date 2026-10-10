import type { BusinessScope } from '../domain/business-scope.js';
import type {
  CancelActorValue,
  OrderStatusValue,
  TransitionActor,
} from '../domain/order-status.js';
import type { Cursor, Page } from '../domain/pagination.js';

export type OrderItemRow = {
  id: string;
  productName: string;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePaise: bigint;
  lineTotalPaise: bigint;
};

export type OrderAddressSnapshot = {
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
};

export type OrderRow = {
  id: string;
  businessId: string;
  customerProfileId: string;
  orderNumber: string;
  status: OrderStatusValue;
  paymentMethod: 'COD' | 'ONLINE' | 'WALLET' | 'CREDIT';
  paymentStatus:
    'DUE' | 'AUTHORIZED' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED' | 'CANCELLED';
  customerNameSnapshot: string;
  customerPhoneSnapshot: string;
  items: OrderItemRow[];
  subtotalPaise: bigint;
  discountPaise: bigint;
  deliveryFeePaise: bigint;
  taxPaise: bigint;
  totalPaise: bigint;
  addressSnapshot: OrderAddressSnapshot;
  serviceDate: Date;
  slotNameSnapshot: string;
  customerNote: string | null;
  internalNote: string | null;
  cancelledByType: CancelActorValue | null;
  cancellationReason: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
};

export type OrderListFilter = {
  status?: OrderStatusValue | undefined;
  limit: number;
  cursor?: Cursor | undefined;
};

export type TransitionInput = {
  toStatus: OrderStatusValue;
  actor: TransitionActor;
  actorUserId?: string | undefined;
  reason?: string | undefined;
};

export interface OrderRepository {
  listForCustomer(
    scope: BusinessScope,
    customerProfileId: string,
    filter: OrderListFilter,
  ): Promise<Page<OrderRow>>;
  getForCustomer(
    scope: BusinessScope,
    customerProfileId: string,
    orderId: string,
  ): Promise<OrderRow | null>;
  listForAdmin(scope: BusinessScope, filter: OrderListFilter): Promise<Page<OrderRow>>;
  getForAdmin(scope: BusinessScope, orderId: string): Promise<OrderRow | null>;
  /**
   * Applies ONE transition. The caller (the service) has already checked
   * `canTransition` — this persists it, stamps the matching timestamp
   * column, and appends an `OrderStatusHistory` row, atomically.
   */
  transition(scope: BusinessScope, orderId: string, input: TransitionInput): Promise<OrderRow>;
  addInternalNote(
    scope: BusinessScope,
    orderId: string,
    note: string,
    actorUserId: string,
  ): Promise<OrderRow>;
  recordCodCollection(
    scope: BusinessScope,
    orderId: string,
    amountPaise: bigint,
    collectedByUserId: string,
  ): Promise<OrderRow>;
}
