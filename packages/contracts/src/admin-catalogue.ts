import { z } from 'zod';

import { moneySchema, paginatedSchema, slugSchema, uuidSchema } from './common.js';

/**
 * Stage F: a variant's unit code is validated against the business's own
 * database-backed, active units (`AdminSettingsService.assertUnitIsActive`)
 * at the service layer, not a fixed enum here — `units.ts`'s `UNIT_CATALOG`
 * now only back-fills the initial rows (`prisma/seed.ts`) and is no longer
 * the source of truth for what a variant may be assigned.
 */
const variantUnitSchema = z.string().trim().min(1).max(20);

/**
 * Admin catalogue management (Phase 04B).
 *
 * Mirrors the public catalogue's data shapes but exposes everything an
 * operator needs to manage a draft/unpublished product (status, internal
 * cost is still never serialised — BR-C7) — never the other way around.
 * The public contracts in catalogue.ts are untouched; this is a separate,
 * additive surface.
 */

// ── Categories ────────────────────────────────────────────────────────────

export const adminCategorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  /** STAGE E: subcategory support — a category with a non-null `parent_id`
   *  is itself a leaf; the service layer enforces exactly two levels
   *  (BR-C1), never deeper. */
  parent_id: uuidSchema.nullable(),
  display_order: z.number().int(),
  is_active: z.boolean(),
  product_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AdminCategoryDto = z.infer<typeof adminCategorySchema>;

export const adminCategoryListResponseSchema = paginatedSchema(adminCategorySchema);
export type AdminCategoryListResponse = z.infer<typeof adminCategoryListResponseSchema>;

export const listAdminCategoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  is_active: z.coerce.boolean().optional(),
});

export const createCategoryBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(2000).optional(),
  image_url: z.string().trim().url().max(2048).optional(),
  /** Set to make this a subcategory. The service refuses a parent that
   *  itself already has a parent — exactly two levels (BR-C1). */
  parent_id: uuidSchema.optional(),
  display_order: z.number().int().min(0).default(0),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  image_url: z.string().trim().url().max(2048).nullable().optional(),
  parent_id: uuidSchema.nullable().optional(),
  display_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

// ── Product variants ────────────────────────────────────────────────────

export const adminVariantSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  unit_value: z.string(),
  mrp: moneySchema.nullable(),
  price: moneySchema,
  /** Basis points (1/100 of a percent) — e.g. 500 = 5%. Default 0 (no tax
   *  configured yet) rather than inferring a rate from anywhere else. */
  tax_rate_bps: z.number().int(),
  availability: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'DISCONTINUED']),
  is_default: z.boolean(),
  display_order: z.number().int(),
  max_order_quantity: z.number().int().nullable(),
  inventory: z
    .object({
      quantity_on_hand: z.number().int(),
      quantity_reserved: z.number().int(),
      quantity_available: z.number().int(),
      low_stock_threshold: z.number().int(),
      track_inventory: z.boolean(),
      allow_backorder: z.boolean(),
    })
    .nullable(),
});
export type AdminVariantDto = z.infer<typeof adminVariantSchema>;

/** `g-k_01` etc — letters, digits, hyphens and underscores only, matching
 *  how SKUs are actually formatted in practice; never blank/whitespace. */
const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_-]+$/, 'SKU may only contain letters, digits, hyphens and underscores');

export const createVariantBodySchema = z.object({
  sku: skuSchema,
  name: z.string().trim().min(1).max(120),
  unit: variantUnitSchema,
  unit_value: z.number().positive(),
  mrp_paise: z.number().int().positive().optional(),
  price_paise: z.number().int().positive(),
  tax_rate_bps: z.number().int().min(0).max(10_000).optional(),
  is_default: z.boolean().optional(),
  max_order_quantity: z.number().int().positive().optional(),
  /** Omitted or zero: no stock tracked yet, set separately via the inventory endpoint. */
  initial_quantity_on_hand: z.number().int().min(0).optional(),
});
export type CreateVariantBody = z.infer<typeof createVariantBodySchema>;

export const updateVariantBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  unit: variantUnitSchema.optional(),
  unit_value: z.number().positive().optional(),
  mrp_paise: z.number().int().positive().nullable().optional(),
  price_paise: z.number().int().positive().optional(),
  tax_rate_bps: z.number().int().min(0).max(10_000).optional(),
  availability: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'DISCONTINUED']).optional(),
  is_default: z.boolean().optional(),
  max_order_quantity: z.number().int().positive().nullable().optional(),
});
export type UpdateVariantBody = z.infer<typeof updateVariantBodySchema>;

export const setVariantStockBodySchema = z.object({
  quantity_on_hand: z.number().int().min(0),
  low_stock_threshold: z.number().int().min(0).optional(),
  allow_backorder: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
export type SetVariantStockBody = z.infer<typeof setVariantStockBodySchema>;

// ── Product images ──────────────────────────────────────────────────────

export const adminProductImageSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  alt_text: z.string().nullable(),
  display_order: z.number().int(),
});
export type AdminProductImageDto = z.infer<typeof adminProductImageSchema>;

/**
 * Direct-URL image workflow (Phase 04B) — kept alongside the PHASE 05
 * device-upload flow (`requestProductImageUploadBodySchema` below) as a
 * separate, backward-compatible path for an admin who already has an
 * image hosted elsewhere and just wants to link it, without re-uploading
 * through this API. Validated as a well-formed https URL with a
 * recognised image extension — the strongest check possible without
 * fetching the bytes.
 */
export const addProductImageBodySchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((v) => v.startsWith('https://'), 'Image URL must be https')
    .refine(
      (v) => /\.(jpe?g|png|webp|avif)(\?.*)?$/i.test(v),
      'URL must end in a recognised image extension',
    ),
  alt_text: z.string().trim().max(200).optional(),
  display_order: z.number().int().min(0).default(0),
});
export type AddProductImageBody = z.infer<typeof addProductImageBodySchema>;

const ALLOWED_UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

/**
 * Device-upload workflow (PHASE 05) — the counterpart to
 * `addProductImageBodySchema`'s "already-hosted URL" path. The client
 * never chooses where the object lands or what content-type it claims
 * beyond this allow-list; the server mints a presigned URL scoped to
 * exactly the content type given here.
 */
export const requestProductImageUploadBodySchema = z.object({
  content_type: z.enum(ALLOWED_UPLOAD_CONTENT_TYPES),
  display_order: z.number().int().min(0).default(0),
});
export type RequestProductImageUploadBody = z.infer<typeof requestProductImageUploadBodySchema>;

export const productImageUploadTicketSchema = z.object({
  image_id: uuidSchema,
  upload_url: z.string(),
  expires_at: z.string().datetime(),
  max_bytes: z.number().int(),
});
export type ProductImageUploadTicket = z.infer<typeof productImageUploadTicketSchema>;

// ── Products ─────────────────────────────────────────────────────────────

export const adminProductStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']);

export const adminProductSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  short_description: z.string().nullable(),
  description: z.string().nullable(),
  status: adminProductStatusSchema,
  category: z.object({ id: uuidSchema, name: z.string() }),
  allergens: z.array(z.string()),
  dietary_tags: z.array(z.string()),
  is_bestseller: z.boolean(),
  is_new: z.boolean(),
  images: z.array(adminProductImageSchema),
  variants: z.array(adminVariantSchema),
  published_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AdminProductDto = z.infer<typeof adminProductSchema>;

export const adminProductListResponseSchema = paginatedSchema(
  adminProductSchema
    .pick({
      id: true,
      name: true,
      slug: true,
      status: true,
      category: true,
      published_at: true,
      updated_at: true,
    })
    .extend({ variant_count: z.number().int(), from_price: moneySchema.nullable() }),
);
export type AdminProductListResponse = z.infer<typeof adminProductListResponseSchema>;

export const listAdminProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  category_id: uuidSchema.optional(),
  status: adminProductStatusSchema.optional(),
});

export const createProductBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  category_id: uuidSchema,
  short_description: z.string().trim().max(300).optional(),
  description: z.string().trim().max(5000).optional(),
  ingredients: z.string().trim().max(2000).optional(),
  allergens: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  dietary_tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category_id: uuidSchema.optional(),
  short_description: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  ingredients: z.string().trim().max(2000).nullable().optional(),
  allergens: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  dietary_tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  is_bestseller: z.boolean().optional(),
  is_new: z.boolean().optional(),
});
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

export const setProductStatusBodySchema = z.object({
  status: adminProductStatusSchema,
});
export type SetProductStatusBody = z.infer<typeof setProductStatusBodySchema>;
