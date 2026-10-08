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

// ── Admin: login ─────────────────────────────────────────────────────────

export const adminLoginBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1), // length is checked at verify time, not here — a short guess must still fail generically.
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
});

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
  password: z.string().min(1),
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
  is_super_admin: z.boolean(),
  roles: z.array(z.string()),
  deactivated: z.boolean(),
});

export const inviteAdminBodySchema = z.object({
  email: z.string().trim().email(),
  full_name: z.string().trim().min(1).max(120),
  designation: z.string().trim().max(120).optional(),
  role_ids: z.array(uuidSchema).min(1),
  /** Base URL the API appends `?token=<raw>` to — the admin app's "set your password" page. */
  password_setup_continue_url: z.string().url().optional(),
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

export type CustomerSessionResponse = z.infer<typeof customerSessionResponseSchema>;
export type AdminMe = z.infer<typeof adminMeSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
