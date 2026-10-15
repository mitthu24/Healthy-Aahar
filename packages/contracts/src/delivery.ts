import { z } from 'zod';

import { loginIdSchema } from './auth.js';
import { moneySchema, paginatedSchema, uuidSchema } from './common.js';
import { orderAddressSnapshotSchema, orderItemSchema } from './order.js';

/**
 * Delivery-partner app + order assignment (PHASE 06).
 *
 * A delivery partner is an `admin_users` row with a restricted
 * `DELIVERY_PARTNER` role plus a 1:1 profile carrying partner-only data
 * (duty status, vehicle details) — there is deliberately no separate
 * partner/user table, reusing the existing invite/session/RBAC machinery
 * wholesale (docs pattern established in Phase 05).
 */

export const dutyStatusSchema = z.enum(['ON_DUTY', 'OFF_DUTY']);
export type DutyStatus = z.infer<typeof dutyStatusSchema>;

export const assignmentStatusSchema = z.enum(['ACTIVE', 'REASSIGNED', 'COMPLETED', 'CANCELLED']);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

// ── Admin-managed partner accounts ─────────────────────────────────────────

export const deliveryPartnerSchema = z.object({
  id: uuidSchema,
  full_name: z.string(),
  email: z.string().nullable(),
  login_id: z.string().nullable(),
  employee_code: z.string().nullable(),
  duty_status: dutyStatusSchema,
  duty_changed_at: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  vehicle_number: z.string().nullable(),
  deactivated: z.boolean(),
  active_delivery_count: z.number().int(),
});
export type DeliveryPartnerDto = z.infer<typeof deliveryPartnerSchema>;

export const deliveryPartnerListResponseSchema = paginatedSchema(deliveryPartnerSchema);
export type DeliveryPartnerListResponse = z.infer<typeof deliveryPartnerListResponseSchema>;

export const listDeliveryPartnersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  duty_status: dutyStatusSchema.optional(),
});

export const createDeliveryPartnerBodySchema = z
  .object({
    email: z.string().trim().email().optional(),
    /** STAGE C: alternative to `email` — see `inviteAdminBodySchema`'s doc comment. */
    login_id: loginIdSchema.optional(),
    full_name: z.string().trim().min(1).max(120),
    employee_code: z.string().trim().max(60).optional(),
    vehicle_type: z.string().trim().max(60).optional(),
    vehicle_number: z.string().trim().max(60).optional(),
  })
  .refine((body) => Boolean(body.email) || Boolean(body.login_id), {
    message: 'An email or a login ID is required.',
    path: ['login_id'],
  });
export type CreateDeliveryPartnerBody = z.infer<typeof createDeliveryPartnerBodySchema>;

export const createDeliveryPartnerResponseSchema = deliveryPartnerSchema.extend({
  /** One-time password-setup link — same no-email-sent convention as inviteAdminResponseSchema. */
  password_setup_link: z.string(),
});
export type CreateDeliveryPartnerResponse = z.infer<typeof createDeliveryPartnerResponseSchema>;

// ── Order assignment (admin side) ──────────────────────────────────────────

export const assignOrderBodySchema = z.object({
  partner_admin_user_id: uuidSchema,
  reason: z.string().trim().max(500).optional(),
});
export type AssignOrderBody = z.infer<typeof assignOrderBodySchema>;

export const assignmentHistoryEntrySchema = z.object({
  id: uuidSchema,
  partner_admin_user_id: uuidSchema,
  partner_name: z.string(),
  status: assignmentStatusSchema,
  reason: z.string().nullable(),
  assigned_at: z.string(),
  ended_at: z.string().nullable(),
});
export type AssignmentHistoryEntryDto = z.infer<typeof assignmentHistoryEntrySchema>;

export const assignmentHistoryResponseSchema = z.object({
  data: z.array(assignmentHistoryEntrySchema),
});
export type AssignmentHistoryResponse = z.infer<typeof assignmentHistoryResponseSchema>;

// ── Partner self-service (duty, assigned deliveries, lifecycle actions) ───

export const updateDutyStatusBodySchema = z.object({ duty_status: dutyStatusSchema });
export type UpdateDutyStatusBody = z.infer<typeof updateDutyStatusBodySchema>;

export const deliveryDashboardSchema = z.object({
  full_name: z.string(),
  duty_status: dutyStatusSchema,
  assigned_count: z.number().int(),
  active_count: z.number().int(),
  completed_today_count: z.number().int(),
});
export type DeliveryDashboardDto = z.infer<typeof deliveryDashboardSchema>;

/**
 * Partner-facing delivery view — deliberately NOT `adminOrderSchema`: a
 * partner only ever sees what's needed to fulfil the ONE delivery assigned
 * to them (docs requirement: never expose unrelated customer records or
 * unnecessary personal data).
 */
export const deliveryOrderSchema = z.object({
  id: uuidSchema,
  order_number: z.string(),
  status: z.enum(['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED']),
  recipient_name: z.string(),
  recipient_phone: z.string(),
  delivery_address: orderAddressSnapshotSchema,
  items: z.array(orderItemSchema),
  payment_method: z.enum(['COD', 'ONLINE', 'WALLET', 'CREDIT']),
  cod_amount_due: moneySchema.nullable(),
  cod_collected: z.boolean(),
  service_date: z.string(),
  slot_name: z.string(),
  customer_note: z.string().nullable(),
  assigned_at: z.string().nullable(),
  failure_reason: z.string().nullable(),
});
export type DeliveryOrderDto = z.infer<typeof deliveryOrderSchema>;

export const deliveryOrderListResponseSchema = paginatedSchema(
  deliveryOrderSchema.pick({
    id: true,
    order_number: true,
    status: true,
    recipient_name: true,
    delivery_address: true,
    service_date: true,
    slot_name: true,
    assigned_at: true,
  }),
);
export type DeliveryOrderListResponse = z.infer<typeof deliveryOrderListResponseSchema>;

export const listMyDeliveriesQuerySchema = z.object({
  status: z.enum(['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const failDeliveryBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type FailDeliveryBody = z.infer<typeof failDeliveryBodySchema>;

export const recordDeliveryCodCollectionBodySchema = z.object({
  amount_paise: z.number().int().positive(),
});
export type RecordDeliveryCodCollectionBody = z.infer<typeof recordDeliveryCodCollectionBodySchema>;
