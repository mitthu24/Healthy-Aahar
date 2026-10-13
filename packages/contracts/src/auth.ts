import { z } from 'zod';

import { uuidSchema } from './common.js';

/**
 * Auth + RBAC contracts (PHASE 03 — email/password, docs/07 + docs/08).
 */

// ── Shared password rules ────────────────────────────────────────────────
// Mirrors packages/auth/src/password.ts#assertPasswordStrength — kept in
// sync by hand (a zod schema cannot import a core-package function without
// creating a dependency cycle); both are exercised by the same test suite.
const passwordSchema = z.string().min(10).max(256);

// Login never required the 10-char minimum (a too-short guess must still
// fail with the same generic error as any other wrong password, not a
// distinguishable 422 — Step 5's no-enumeration rule applies to length too).
// It DOES share the same 256-char maximum as every other password field
// (Fix #8): no credential created anywhere in this system — register,
// admin password-setup, reset — can ever exceed 256 chars, so capping
// login at 256 rejects nothing a real credential could be, while capping
// the cheap, unauthenticated cost of hashing an attacker-supplied
// multi-megabyte string on every login attempt (the same CPU-exhaustion
// reasoning as `assertPasswordStrength`'s upper bound). Zod `.max()`
// REJECTS an oversized value with 422 — it never silently truncates.
const loginPasswordSchema = z.string().min(1).max(256);

// ── Admin: login ─────────────────────────────────────────────────────────

export const adminLoginBodySchema = z.object({
  email: z.string().trim().email(),
  password: loginPasswordSchema,
});

export const adminMeSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  full_name: z.string(),
  email: z.string().nullable(),
  designation: z.string().nullable(),
  is_super_admin: z.boolean(),
  permissions: z.array(z.string()),
  roles: z.array(z.string()),
  /** True when this admin has never changed their password since the
   *  account was created/bootstrapped — the UI must force a change (Phase 04). */
  must_change_password: z.boolean(),
});

export const changeOwnPasswordBodySchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});
export type ChangeOwnPasswordBody = z.infer<typeof changeOwnPasswordBodySchema>;

// ── Customer: register / login ──────────────────────────────────────────

export const customerRegisterBodySchema = z.object({
  email: z.string().trim().email(),
  password: passwordSchema,
  phone: z.string().trim().min(1).optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
});

export const customerLoginBodySchema = z.object({
  email: z.string().trim().email(),
  password: loginPasswordSchema,
});

export const customerSchema = z.object({
  id: uuidSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
});

export const customerProfileSchema = z.object({
  id: uuidSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  display_name: z.string().nullable(),
});

/**
 * `token` is the raw bearer session token, returned exactly once (docs/30
 * §2 — the customer API stays cookie-free for mobile-readiness). The
 * frontend holds it in memory / platform secure storage and sends it back
 * as `Authorization: Bearer <token>`; it is never persisted by this API
 * beyond its hash in `sessions.token_hash`.
 */
export const customerSessionResponseSchema = z.object({
  user: customerSchema,
  profile: customerProfileSchema,
  token: z.string(),
});

export const customerWhoAmISchema = z.object({
  user_id: uuidSchema,
  customer_profile_id: uuidSchema,
});

// ── Password setup / reset (shared by admin invite + future self-service) ─

export const passwordSetupBodySchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

// ── Admin users (RBAC) ───────────────────────────────────────────────────

export const adminUserSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  email: z.string().nullable(),
  full_name: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  is_super_admin: z.boolean(),
  roles: z.array(z.string()),
  deactivated: z.boolean(),
});

export const inviteAdminBodySchema = z.object({
  email: z.string().trim().email(),
  full_name: z.string().trim().min(1).max(120),
  designation: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  role_ids: z.array(uuidSchema).min(1),
  /** Base URL the API appends `?token=<raw>` to — the admin app's "set your password" page. */
  password_setup_continue_url: z.string().url().optional(),
});

export const updateAdminDetailsBodySchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  designation: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
});

export const listAdminUsersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});

export const inviteAdminResponseSchema = adminUserSchema.extend({
  /**
   * The one-time password-setup link. No email is sent by this API (no
   * Brevo wiring is part of this phase) — whoever called this endpoint is
   * responsible for delivering it to the invited admin out of band.
   */
  password_setup_link: z.string(),
});

export const setAdminRolesBodySchema = z.object({
  role_ids: z.array(uuidSchema).min(1),
});

// ── Fix #2: authorized password-reset-token issuance for an EXISTING admin ─

export const resetAdminPasswordBodySchema = z.object({
  /** Base URL the API appends `?token=<raw>` to — same convention as invite. */
  password_setup_continue_url: z.string().url().optional(),
});

export const passwordSetupLinkResponseSchema = z.object({
  /** One-time, single-use. Never logged; delivered by the caller out of band. */
  password_setup_link: z.string(),
});

export const adminUserListResponseSchema = z.object({ data: z.array(adminUserSchema) });

// ── Roles & permissions ───────────────────────────────────────────────────

export const permissionSchema = z.object({
  key: z.string(),
  resource: z.string(),
  action: z.string(),
  description: z.string(),
});

export const roleSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_system: z.boolean(),
  permissions: z.array(z.string()),
});

export const createRoleBodySchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Role key must be UPPER_SNAKE_CASE'),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  permission_keys: z.array(z.string()).default([]),
});

export const updateRolePermissionsBodySchema = z.object({
  permission_keys: z.array(z.string()),
});

export const roleListResponseSchema = z.object({ data: z.array(roleSchema) });
export const permissionListResponseSchema = z.object({ data: z.array(permissionSchema) });

// ── Audit log (read path) ────────────────────────────────────────────────

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  actor_user_id: uuidSchema.nullable(),
  actor_type: z.enum(['ADMIN', 'SYSTEM']),
  actor_email: z.string().nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});

export const listAuditLogQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  actor_user_id: uuidSchema.optional(),
  action: z.string().trim().max(100).optional(),
  resource_type: z.string().trim().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const auditLogListResponseSchema = z.object({
  data: z.array(auditLogEntrySchema),
  pagination: z.object({
    limit: z.number(),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
});

export type CustomerSessionResponse = z.infer<typeof customerSessionResponseSchema>;
export type AdminMe = z.infer<typeof adminMeSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
