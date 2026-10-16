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

// ── Stage C: email-free login identifier ────────────────────────────────
// Normalized to lowercase before storage/comparison — citext makes the
// uniqueness constraint itself case-insensitive too, but normalizing here
// keeps every stored value in one canonical form rather than relying on
// citext alone. The charset deliberately excludes `@`, so a login ID can
// never collide in SHAPE with an email — `AdminAuthService.login` relies on
// this to try "is it an email" then "is it a login ID" without ambiguity.
export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(
    /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/,
    'Login ID must be 3-32 characters (letters, numbers, dots, underscores or hyphens), starting and ending with a letter or number.',
  );

// ── Admin: login ─────────────────────────────────────────────────────────
// `email` is kept as the wire field name for backward compatibility (every
// existing admin/delivery login call already sends it), but as of Stage C
// it accepts either a registered email OR a login ID — deliberately NOT
// validated with `.email()` any more, since a login ID is never
// email-shaped. The login service tries both lookups and returns the SAME
// generic error either way, so this looser shape cannot be used to
// enumerate accounts.

export const adminLoginBodySchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: loginPasswordSchema,
});

export const adminMeSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  full_name: z.string(),
  email: z.string().nullable(),
  login_id: z.string().nullable(),
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

// STAGE E: founder-assigned employee/HR identifier — distinct from
// `login_id` (which gates authentication). Case is preserved (unlike
// `login_id`): businesses commonly already use a specific-case employee
// code scheme (e.g. "EMP-014") elsewhere, and normalizing it here would
// make the stored value diverge from whatever the founder actually types.
export const employeeCodeSchema = z.string().trim().min(1).max(40);

export const adminUserSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  email: z.string().nullable(),
  login_id: z.string().nullable(),
  employee_code: z.string().nullable(),
  full_name: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  is_super_admin: z.boolean(),
  roles: z.array(z.string()),
  deactivated: z.boolean(),
});

export const inviteAdminBodySchema = z
  .object({
    email: z.string().trim().email().optional(),
    /** STAGE C: alternative to `email` — a founder creating a staff
     *  account with no email address supplies this instead. At least one
     *  of the two is required (enforced by `.refine` below). Stage F keeps
     *  this in the API contract (an existing, tested capability — an
     *  employee already signing in with a login ID must keep working) even
     *  though the standard admin-UI invite form no longer exposes this
     *  field, offering only email + password. */
    login_id: loginIdSchema.optional(),
    /** STAGE E: required for every employee record, unique within the business. */
    employee_code: employeeCodeSchema,
    full_name: z.string().trim().min(1).max(120),
    designation: z.string().trim().max(120).optional(),
    department: z.string().trim().max(120).optional(),
    role_ids: z.array(uuidSchema).min(1),
    /** Stage F: an admin-chosen initial password — the employee must change
     *  it at first login (`mustChangePassword`). Mutually exclusive in
     *  practice with the setup-link flow below (the service only issues a
     *  link when this is omitted), but both remain valid API shapes so the
     *  setup-link flow keeps working for any caller that prefers it. */
    password: z.string().trim().min(10).max(256).optional(),
    /** Base URL the API appends `?token=<raw>` to — the admin app's "set your password" page.
     *  Only meaningful when `password` is omitted. */
    password_setup_continue_url: z.string().url().optional(),
  })
  .refine((body) => Boolean(body.email) || Boolean(body.login_id), {
    message: 'An email or a login ID is required.',
    path: ['login_id'],
  });

export const updateAdminDetailsBodySchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  designation: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  employee_code: employeeCodeSchema.optional(),
});

export const listAdminUsersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});

export const inviteAdminResponseSchema = adminUserSchema.extend({
  /**
   * The one-time password-setup link, or `null` when the inviter instead
   * chose an initial password (`password` in the request body) — in that
   * case there is nothing left for a setup link to authorize, since the
   * account already has a credential (the employee must still change it at
   * first login).
   */
  password_setup_link: z.string().nullable(),
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
  /** Stage F: whether the reset email was actually delivered through the
   *  configured channel — honestly reported; `SKIPPED` means no provider is
   *  configured in this environment (see `RbacService.resetAdminPassword`),
   *  never claimed as `SENT` when it wasn't. The link is always returned
   *  regardless, as a fallback the admin can relay manually. */
  email_status: z.enum(['SENT', 'SKIPPED', 'FAILED']),
});

/** Stage F — "Generate temporary password": the plaintext is returned
 *  exactly once, in this response only — never persisted, logged, or
 *  retrievable again after this call. */
export const temporaryPasswordResponseSchema = z.object({
  temporary_password: z.string(),
});
export type TemporaryPasswordResponse = z.infer<typeof temporaryPasswordResponseSchema>;

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
