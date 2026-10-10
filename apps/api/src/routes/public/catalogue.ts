import {
  categoryListResponseSchema,
  errorResponseSchema,
  listProductsQuerySchema,
  productDetailSchema,
  productListResponseSchema,
} from '@healthy-aahar/contracts';
import {
  businessScope,
  money,
  type CategoryRow,
  type ProductDetailRow,
  type ProductSummaryRow,
} from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/** Public, read-only catalogue (docs/14 §3.2-3.3). No cost price ever leaves this file. */

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'GET',
  path: '/v1/public/categories',
  audience: 'public',
  summary: 'List active categories',
  phase: '04',
  openapi: {
    tags: ['Catalogue'],
    responses: { 200: { description: 'Categories', schema: categoryListResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/public/products',
  audience: 'public',
  summary: 'List active products',
  phase: '04',
  openapi: {
    tags: ['Catalogue'],
    request: { query: listProductsQuerySchema },
    responses: { 200: { description: 'Products', schema: productListResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/public/products/{slug}',
  audience: 'public',
  summary: 'Get a product by slug',
  phase: '04',
  errors: ['PRODUCT_NOT_FOUND'],
  openapi: {
    tags: ['Catalogue'],
    responses: {
      200: { description: 'Product', schema: productDetailSchema },
      404: jsonError('Not found'),
    },
  },
});

function toVariantDto(variant: ProductSummaryRow['defaultVariant']) {
  return {
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    unit: variant.unit,
    unit_value: variant.unitValue,
    mrp: variant.mrpPaise !== null ? money(Number(variant.mrpPaise)) : null,
    price: money(Number(variant.pricePaise)),
    availability: variant.availability,
    is_default: variant.isDefault,
    max_order_quantity: variant.maxOrderQuantity,
  };
}

function toSummaryDto(row: ProductSummaryRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    short_description: row.shortDescription,
    image_url: row.imageUrl,
    category: row.category,
    dietary_tags: row.dietaryTags,
    is_bestseller: row.isBestseller,
    is_new: row.isNew,
    from_price: money(Number(row.defaultVariant.pricePaise)),
    default_variant_id: row.defaultVariant.id,
    availability: row.defaultVariant.availability,
  };
}

function toDetailDto(row: ProductDetailRow) {
  return {
    ...toSummaryDto(row),
    description: row.description,
    ingredients: row.ingredients,
    allergens: row.allergens,
    images: row.images,
    variants: row.variants.map(toVariantDto),
  };
}

function toCategoryDto(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image_url: row.imageUrl,
    display_order: row.displayOrder,
  };
}

export function publicCatalogueRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/categories', async (c) => {
    const categories = await c.env.services.catalogue.listCategories(
      businessScope(c.env.businessId),
    );
    return c.json({ data: categories.map(toCategoryDto) }, 200, {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    });
  });

  app.get('/products', async (c) => {
    const query = listProductsQuerySchema.parse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      category_id: c.req.query('category_id'),
      q: c.req.query('q'),
    });

    const page = await c.env.services.catalogue.listProducts(businessScope(c.env.businessId), {
      limit: query.limit,
      cursor: query.cursor,
      ...(query.category_id ? { categoryId: query.category_id } : {}),
      ...(query.q ? { q: query.q } : {}),
    });

    return c.json({ data: page.data.map(toSummaryDto), pagination: page.pagination }, 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    });
  });

  app.get('/products/:slug', async (c) => {
    const product = await c.env.services.catalogue.getProductBySlug(
      businessScope(c.env.businessId),
      c.req.param('slug'),
    );
    return c.json(toDetailDto(product), 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    });
  });

  return app;
}
