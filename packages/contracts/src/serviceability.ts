import { z } from 'zod';

import {
  pincodeSchema,
  serviceabilityStatusSchema,
  slugSchema,
  uuidSchema,
  paginationQuerySchema,
} from './common.js';

/**
 * Serviceability contracts (PHASE 01).
 *
 * These are the schemas the public and admin serviceability endpoints will
 * use. They are defined now — ahead of the admin UI — because the API shape
 * is a contract that the customer app, the marketing site and the future
 * mobile apps all depend on, and it must not be invented per-surface.
 */

// ── Resources ─────────────────────────────────────────────────────────────

export const cityPublicSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  display_name: z.string(),
  state: z.string(),
  country: z.string(),
  timezone: z.string(),
  status: serviceabilityStatusSchema,
  is_serviceable: z.boolean(),
});

export const cityAdminSchema = cityPublicSchema.extend({
  display_order: z.number().int(),
  activated_at: z.string().datetime().nullable(),
  pincode_count: z.number().int(),
  active_pincode_count: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const pincodePublicSchema = z.object({
  id: uuidSchema,
  pincode: z.string(),
  area_name: z.string().nullable(),
  status: serviceabilityStatusSchema,
  is_serviceable: z.boolean(),
  city: z.object({
    id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    state: z.string(),
  }),
});

export const pincodeAdminSchema = pincodePublicSchema.extend({
  display_order: z.number().int(),
  activated_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ── Serviceability check ──────────────────────────────────────────────────

/**
 * Why a location is not serviceable. Returned so the UI can explain itself:
 * "we do not deliver to 201305 yet" converts very differently from a blank
 * rejection, and the two cases below are genuinely different messages.
 */
export const notServiceableReasonSchema = z.enum([
  'PINCODE_NOT_FOUND',
  'PINCODE_INACTIVE',
  'CITY_INACTIVE',
  'CITY_COMING_SOON',
  'PINCODE_COMING_SOON',
]);

export const serviceabilityQuerySchema = z.object({
  pincode: pincodeSchema,
});

export const serviceabilityResponseSchema = z.object({
  pincode: z.string(),
  is_serviceable: z.boolean(),
  reason: notServiceableReasonSchema.nullable(),
  message: z.string(),
  city: cityPublicSchema.pick({ id: true, name: true, slug: true, state: true }).nullable(),
  area_name: z.string().nullable(),
  /** True when we intend to serve this location but have not launched yet —
   *  the difference between "no" and "not yet", which is a demand signal. */
  waitlist_available: z.boolean(),
});

export type ServiceabilityResponse = z.infer<typeof serviceabilityResponseSchema>;
export type NotServiceableReason = z.infer<typeof notServiceableReasonSchema>;

// ── Public listing ────────────────────────────────────────────────────────

export const listCitiesQuerySchema = paginationQuerySchema.extend({
  status: serviceabilityStatusSchema.optional(),
  state: z.string().optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

export const listPincodesQuerySchema = paginationQuerySchema.extend({
  city_id: uuidSchema.optional(),
  status: serviceabilityStatusSchema.optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

// ── Admin mutations ───────────────────────────────────────────────────────

export const createCityBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  display_name: z.string().trim().max(80).optional(),
  state: z.string().trim().min(1).max(80),
  country: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .default('IN'),
  timezone: z.string().trim().min(1).default('Asia/Kolkata'),
  display_order: z.number().int().min(0).default(0),
});

export const updateCityBodySchema = createCityBodySchema.partial().omit({ slug: true });

export const createPincodeBodySchema = z.object({
  city_id: uuidSchema,
  pincode: pincodeSchema,
  area_name: z.string().trim().max(120).optional(),
  display_order: z.number().int().min(0).default(0),
});

export const updatePincodeBodySchema = createPincodeBodySchema.partial().omit({ pincode: true });

/**
 * Deactivation requires a reason. Turning a city off stops revenue from an
 * entire market; an unexplained change of that size is a governance failure,
 * not a convenience (BR-SV5).
 */
export const deactivateBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type CityPublic = z.infer<typeof cityPublicSchema>;
export type CityAdmin = z.infer<typeof cityAdminSchema>;
export type PincodePublic = z.infer<typeof pincodePublicSchema>;
export type PincodeAdmin = z.infer<typeof pincodeAdminSchema>;
