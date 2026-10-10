import { z } from 'zod';

import { moneySchema, paginatedSchema, slugSchema, uuidSchema } from './common.js';

/**
 * Public, read-only catalogue (docs/14 §3.2, §3.3; docs/06 §catalogue).
 *
 * This is a read surface only — creation/editing of catalogue entities is
 * admin tooling for a later pass (docs/34 PHASE 05). A product's cost price
 * is never part of this schema; it never leaves the database (BR-C-cost).
 */

export const categorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  display_order: z.number().int(),
});
export type CategoryDto = z.infer<typeof categorySchema>;

export const categoryListResponseSchema = z.object({ data: z.array(categorySchema) });

export const productVariantSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  unit_value: z.string(),
  mrp: moneySchema.nullable(),
  price: moneySchema,
  availability: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'DISCONTINUED']),
  is_default: z.boolean(),
  max_order_quantity: z.number().int().nullable(),
});
export type ProductVariantDto = z.infer<typeof productVariantSchema>;

export const productSummarySchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  name: z.string(),
  short_description: z.string().nullable(),
  image_url: z.string().nullable(),
  category: z.object({ id: uuidSchema, name: z.string(), slug: slugSchema }),
  dietary_tags: z.array(z.string()),
  is_bestseller: z.boolean(),
  is_new: z.boolean(),
  from_price: moneySchema,
  default_variant_id: uuidSchema,
  availability: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'DISCONTINUED']),
});
export type ProductSummaryDto = z.infer<typeof productSummarySchema>;

export const productDetailSchema = productSummarySchema.extend({
  description: z.string().nullable(),
  ingredients: z.string().nullable(),
  allergens: z.array(z.string()),
  dietary_tags: z.array(z.string()),
  images: z.array(z.object({ url: z.string(), alt_text: z.string().nullable() })),
  variants: z.array(productVariantSchema),
});
export type ProductDetailDto = z.infer<typeof productDetailSchema>;

export const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  category_id: uuidSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const productListResponseSchema = paginatedSchema(productSummarySchema);
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
