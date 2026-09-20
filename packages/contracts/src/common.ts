import { z } from 'zod';

/**
 * Shared primitives for every endpoint (docs/06-API-SPECIFICATION.md §1).
 */

/** UUIDv7 — validated as a UUID; version is not enforced at the boundary
 *  because a client should never be constructing one anyway. */
export const uuidSchema = z.string().uuid();

/** E.164, as stored on users.phone. */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, for example +919876543210');

/** Indian pincode: six digits, never a leading zero. Mirrors the database
 *  CHECK constraint exactly — validation in two places, one definition. */
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export const pincodeSchema = z
  .string()
  .trim()
  .regex(PINCODE_PATTERN, 'Pincode must be 6 digits and cannot start with 0');

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase, hyphen-separated');

/**
 * Money is always this shape — never a bare number, never a string
 * (ADR-006, docs/06 §1.8). The client performs no currency arithmetic and no
 * formatting; `display` is computed once, on the server.
 */
export const moneySchema = z.object({
  amount_paise: z.number().int(),
  currency: z.string().length(3),
  display: z.string(),
});

export type Money = z.infer<typeof moneySchema>;

/**
 * Cursor pagination, never offset. Offset pagination skips or repeats rows
 * when the underlying set changes between pages, which is unacceptable on a
 * list that is actively being written (docs/06 §1.3).
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const paginationMetaSchema = z.object({
  limit: z.number().int(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: paginationMetaSchema,
  });
}

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Serviceability state, mirroring the database enum. */
export const serviceabilityStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'COMING_SOON']);
export type ServiceabilityStatusDto = z.infer<typeof serviceabilityStatusSchema>;

export const appEnvSchema = z.enum(['local', 'preview', 'staging', 'production']);
