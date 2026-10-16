import { z } from 'zod';

import { uuidSchema } from './common.js';

/**
 * Stage F — admin-managed catalogue settings: database-backed units and the
 * configurable tax-rate ceiling. Business-scoped, like every other
 * catalogue contract in this codebase.
 */

export const unitDimensionSchema = z.enum(['MASS', 'VOLUME', 'COUNT']);
export type AdminUnitDimension = z.infer<typeof unitDimensionSchema>;

/** `code` deliberately mirrors `sku`'s charset — stable, URL/CSV-safe,
 *  never free-text that could collide visually (e.g. "l" vs "1"). */
const unitCodeFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, 'Unit code may only contain letters, digits, hyphens and underscores');

export const adminUnitSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  label: z.string(),
  symbol: z.string(),
  dimension: unitDimensionSchema,
  is_active: z.boolean(),
});
export type AdminUnitDto = z.infer<typeof adminUnitSchema>;

export const adminUnitListResponseSchema = z.object({ data: z.array(adminUnitSchema) });
export type AdminUnitListResponse = z.infer<typeof adminUnitListResponseSchema>;

export const createUnitBodySchema = z.object({
  code: unitCodeFieldSchema,
  label: z.string().trim().min(1).max(60),
  symbol: z.string().trim().min(1).max(10),
  dimension: unitDimensionSchema,
});
export type CreateUnitBody = z.infer<typeof createUnitBodySchema>;

export const updateUnitBodySchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  symbol: z.string().trim().min(1).max(10).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateUnitBody = z.infer<typeof updateUnitBodySchema>;

export const listUnitsQuerySchema = z.object({
  active_only: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListUnitsQuery = z.infer<typeof listUnitsQuerySchema>;

// ── Catalogue settings (tax-rate ceiling) ──────────────────────────────────

export const catalogueSettingsSchema = z.object({
  max_tax_rate_bps: z.number().int().min(0).max(10_000),
});
export type CatalogueSettingsDto = z.infer<typeof catalogueSettingsSchema>;

export const updateCatalogueSettingsBodySchema = z.object({
  max_tax_rate_bps: z.number().int().min(0).max(10_000),
});
export type UpdateCatalogueSettingsBody = z.infer<typeof updateCatalogueSettingsBodySchema>;
