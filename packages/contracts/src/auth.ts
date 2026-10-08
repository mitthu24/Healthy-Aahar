import { z } from 'zod';

import { uuidSchema } from './common.js';

/**
 * Auth + RBAC contracts (PHASE 03, docs/07 + docs/08).
 */

export const bearerSessionBodySchema = z.object({
  id_token: z.string().min(1),
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

export const customerSessionResponseSchema = z.object({
  user: customerSchema,
  profile: customerProfileSchema,
});

export const customerWhoAmISchema = z.object({
  user_id: uuidSchema,
  customer_profile_id: uuidSchema,
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
