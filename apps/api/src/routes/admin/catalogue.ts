import {
  addProductImageBodySchema,
  adminCategoryListResponseSchema,
  adminCategorySchema,
  adminProductListResponseSchema,
  adminProductSchema,
  adminVariantSchema,
  createCategoryBodySchema,
  createProductBodySchema,
  createVariantBodySchema,
  errorResponseSchema,
  listAdminCategoriesQuerySchema,
  listAdminProductsQuerySchema,
  productImageUploadTicketSchema,
  requestProductImageUploadBodySchema,
  setProductStatusBodySchema,
  setVariantStockBodySchema,
  updateCategoryBodySchema,
  updateProductBodySchema,
  updateVariantBodySchema,
} from '@healthy-aahar/contracts';
import {
  businessScope,
  toAdminCategoryView,
  toAdminProductSummaryView,
  toAdminProductView,
  toAdminVariantView,
} from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Admin catalogue management (Phase 04B).
 *
 * Public visibility is unchanged: the public catalogue routes
 * (routes/public/catalogue.ts) still read only `status = 'ACTIVE'`
 * products, so nothing created or edited here is visible to a customer
 * until `POST /products/{id}/status` sets it ACTIVE — and that route
 * refuses to do so with zero variants (AdminCatalogueService).
 */

// ── Categories ───────────────────────────────────────────────────────────

registerRoute({
  method: 'GET',
  path: '/v1/admin/categories',
  audience: 'admin',
  permission: 'catalog:read',
  summary: 'List categories',
  phase: '04b',
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { query: listAdminCategoriesQuerySchema },
    responses: { 200: { description: 'Categories', schema: adminCategoryListResponseSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/categories',
  audience: 'admin',
  permission: 'catalog:create',
  summary: 'Create a category',
  phase: '04b',
  errors: [
    'SLUG_ALREADY_IN_USE',
    'VALIDATION_FAILED',
    'CATEGORY_NOT_FOUND',
    'INVALID_CATEGORY_PARENT',
  ],
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { body: createCategoryBodySchema },
    responses: {
      201: { description: 'Created', schema: adminCategorySchema },
      409: jsonError('Slug in use'),
      422: jsonError('parent_id names a category that is itself a subcategory'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/categories/{id}',
  audience: 'admin',
  permission: 'catalog:read',
  summary: 'Get a category',
  phase: '04b',
  errors: ['CATEGORY_NOT_FOUND'],
  openapi: {
    tags: ['Admin: Catalogue'],
    responses: {
      200: { description: 'Category', schema: adminCategorySchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/categories/{id}',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Update a category',
  phase: '04b',
  errors: ['CATEGORY_NOT_FOUND', 'INVALID_CATEGORY_PARENT'],
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { body: updateCategoryBodySchema },
    responses: {
      200: { description: 'Updated', schema: adminCategorySchema },
      404: jsonError('Not found'),
      422: jsonError('Invalid parent_id — self-reference, 3rd level, or has its own subcategories'),
    },
  },
});

registerRoute({
  method: 'DELETE',
  path: '/v1/admin/categories/{id}',
  audience: 'admin',
  permission: 'catalog:delete',
  summary: 'Delete a category (refused while it still has products)',
  phase: '04b',
  errors: ['CATEGORY_NOT_FOUND', 'CATEGORY_HAS_PRODUCTS'],
  openapi: {
    tags: ['Admin: Catalogue'],
    responses: { 204: { description: 'Deleted' }, 409: jsonError('Category still has products') },
  },
});

// ── Products ─────────────────────────────────────────────────────────────

registerRoute({
  method: 'GET',
  path: '/v1/admin/products',
  audience: 'admin',
  permission: 'catalog:read',
  summary: 'List products',
  phase: '04b',
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { query: listAdminProductsQuerySchema },
    responses: { 200: { description: 'Products', schema: adminProductListResponseSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/products',
  audience: 'admin',
  permission: 'catalog:create',
  summary: 'Create a product (always starts DRAFT)',
  phase: '04b',
  errors: ['CATEGORY_NOT_FOUND', 'SLUG_ALREADY_IN_USE'],
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { body: createProductBodySchema },
    responses: { 201: { description: 'Created', schema: adminProductSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/products/{id}',
  audience: 'admin',
  permission: 'catalog:read',
  summary: 'Get a product',
  phase: '04b',
  errors: ['PRODUCT_NOT_FOUND'],
  openapi: {
    tags: ['Admin: Catalogue'],
    responses: {
      200: { description: 'Product', schema: adminProductSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/products/{id}',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Update a product',
  phase: '04b',
  errors: ['PRODUCT_NOT_FOUND', 'CATEGORY_NOT_FOUND'],
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { body: updateProductBodySchema },
    responses: { 200: { description: 'Updated', schema: adminProductSchema } },
  },
});

registerRoute({
  method: 'DELETE',
  path: '/v1/admin/products/{id}',
  audience: 'admin',
  permission: 'catalog:delete',
  summary: 'Delete a product with no order history (prefer archiving otherwise)',
  phase: 'stage-e',
  errors: ['PRODUCT_NOT_FOUND', 'PRODUCT_REFERENCED_BY_ORDERS'],
  openapi: {
    description:
      'Soft-deletes the product and its variants. Refused with 409 if any variant has ' +
      'ever appeared in an order, a combo, or an inventory movement — archive ' +
      '(POST .../status with ARCHIVED) instead, which never touches order history.',
    tags: ['Admin: Catalogue'],
    responses: {
      204: { description: 'Deleted' },
      409: jsonError('This product has order or inventory history — archive it instead'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/products/{id}/status',
  audience: 'admin',
  permission: 'catalog:publish',
  summary: "Change a product's status (publish/unpublish/archive)",
  phase: '04b',
  errors: ['PRODUCT_NOT_FOUND', 'PRODUCT_NOT_PUBLISHABLE'],
  openapi: {
    description: 'Setting ACTIVE is refused with zero variants (nothing to sell).',
    tags: ['Admin: Catalogue'],
    request: { body: setProductStatusBodySchema },
    responses: {
      200: { description: 'Status changed', schema: adminProductSchema },
      409: jsonError('Cannot publish a product with no variants'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/products/{id}/images',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Add a product image by URL',
  phase: '04b',
  errors: ['PRODUCT_NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    description:
      'Direct-URL workflow: packages/storage has no upload adapter yet (PHASE 05) — ' +
      'the admin supplies an already-hosted https image URL rather than this API ' +
      'inventing an upload pipeline.',
    tags: ['Admin: Catalogue'],
    request: { body: addProductImageBodySchema },
    responses: { 200: { description: 'Image added', schema: adminProductSchema } },
  },
});

registerRoute({
  method: 'DELETE',
  path: '/v1/admin/products/{id}/images/{imageId}',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Remove a product image',
  phase: '04b',
  errors: ['PRODUCT_NOT_FOUND'],
  openapi: {
    tags: ['Admin: Catalogue'],
    responses: { 200: { description: 'Image removed', schema: adminProductSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/products/{id}/images/upload-url',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Request a presigned URL to upload a product image from a device',
  phase: '05',
  errors: ['PRODUCT_NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    description:
      'Step 1 of the device-upload flow. The returned upload_url is a short-lived ' +
      'presigned PUT URL — the client uploads the file bytes directly to object ' +
      'storage, then calls the confirm endpoint. The image does not appear on the ' +
      'product until confirmed.',
    tags: ['Admin: Catalogue'],
    request: { body: requestProductImageUploadBodySchema },
    responses: {
      200: { description: 'Upload ticket issued', schema: productImageUploadTicketSchema },
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/products/{id}/images/{imageId}/confirm',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Confirm a device upload finished and attach it to the product',
  phase: '05',
  errors: ['PRODUCT_NOT_FOUND', 'IMAGE_NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    description:
      'Step 2 of the device-upload flow. Independently re-verifies what actually ' +
      'landed in storage (existence, content type, size) before the image becomes ' +
      'visible — never trusts the client that the upload succeeded.',
    tags: ['Admin: Catalogue'],
    responses: { 200: { description: 'Upload confirmed', schema: adminProductSchema } },
  },
});

// ── Variants ─────────────────────────────────────────────────────────────

registerRoute({
  method: 'POST',
  path: '/v1/admin/products/{id}/variants',
  audience: 'admin',
  permission: 'catalog:create',
  summary: 'Add a variant to a product',
  phase: '04b',
  errors: ['PRODUCT_NOT_FOUND', 'VALIDATION_FAILED', 'SKU_TAKEN'],
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { body: createVariantBodySchema },
    responses: {
      201: { description: 'Variant created', schema: adminVariantSchema },
      409: jsonError('SKU already in use'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/variants/{id}',
  audience: 'admin',
  permission: 'catalog:update',
  summary: 'Update a variant',
  phase: '04b',
  errors: ['VARIANT_NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Catalogue'],
    request: { body: updateVariantBodySchema },
    responses: { 200: { description: 'Variant updated', schema: adminVariantSchema } },
  },
});

registerRoute({
  method: 'DELETE',
  path: '/v1/admin/variants/{id}',
  audience: 'admin',
  permission: 'catalog:delete',
  summary: 'Delete a variant with no order history (prefer discontinuing otherwise)',
  phase: 'stage-e',
  errors: ['VARIANT_NOT_FOUND', 'VARIANT_REFERENCED_BY_ORDERS'],
  openapi: {
    description:
      'Soft-deletes the variant. Refused with 409 if it has ever appeared in an order, ' +
      'a combo, or an inventory movement — set it DISCONTINUED instead (PATCH with ' +
      'availability), which never touches order history.',
    tags: ['Admin: Catalogue'],
    responses: {
      204: { description: 'Deleted' },
      409: jsonError('This variant has order or inventory history — discontinue it instead'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/variants/{id}/stock',
  audience: 'admin',
  permission: 'inventory:adjust',
  summary: "Set a variant's on-hand stock",
  phase: '04b',
  errors: ['VARIANT_NOT_FOUND', 'STOCK_BELOW_RESERVED'],
  openapi: {
    description:
      'Sets quantity_on_hand to an absolute value via a conditional update; ' +
      'never touches quantity_reserved, which the checkout/fulfilment flow owns ' +
      'exclusively. Refused (409) if the new value is below what is already ' +
      'reserved for pending orders, unless allow_backorder is set.',
    tags: ['Admin: Catalogue'],
    request: { body: setVariantStockBodySchema },
    responses: {
      200: { description: 'Stock updated', schema: adminVariantSchema },
      409: jsonError('New stock is below quantity already reserved'),
    },
  },
});

export function adminCatalogueRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/categories', async (c) => {
    const query = listAdminCategoriesQuerySchema.parse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      q: c.req.query('q'),
      is_active: c.req.query('is_active'),
    });
    const page = await c.env.services.adminCatalogue.listCategories(
      businessScope(c.env.businessId),
      {
        limit: query.limit,
        cursor: query.cursor,
        q: query.q,
        isActive: query.is_active,
      },
    );
    return c.json({ data: page.data.map(toAdminCategoryView), pagination: page.pagination });
  });

  app.post('/categories', async (c) => {
    const body = createCategoryBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const category = await c.env.services.adminCatalogue.createCategory(
      businessScope(c.env.businessId),
      {
        name: body.name,
        slug: body.slug,
        description: body.description,
        imageUrl: body.image_url,
        parentId: body.parent_id,
        displayOrder: body.display_order,
      },
      actor.userId,
    );
    return c.json(toAdminCategoryView(category), 201);
  });

  app.get('/categories/:id', async (c) => {
    const category = await c.env.services.adminCatalogue.getCategory(
      businessScope(c.env.businessId),
      c.req.param('id'),
    );
    return c.json(toAdminCategoryView(category));
  });

  app.patch('/categories/:id', async (c) => {
    const body = updateCategoryBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const category = await c.env.services.adminCatalogue.updateCategory(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.image_url !== undefined ? { imageUrl: body.image_url } : {}),
        ...(body.parent_id !== undefined ? { parentId: body.parent_id } : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
      },
      actor.userId,
    );
    return c.json(toAdminCategoryView(category));
  });

  app.delete('/categories/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    await c.env.services.adminCatalogue.deleteCategory(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.userId,
    );
    return c.body(null, 204);
  });

  app.get('/products', async (c) => {
    const query = listAdminProductsQuerySchema.parse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      q: c.req.query('q'),
      category_id: c.req.query('category_id'),
      status: c.req.query('status'),
    });
    const page = await c.env.services.adminCatalogue.listProducts(businessScope(c.env.businessId), {
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
      categoryId: query.category_id,
      status: query.status,
    });
    return c.json({ data: page.data.map(toAdminProductSummaryView), pagination: page.pagination });
  });

  app.post('/products', async (c) => {
    const body = createProductBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const product = await c.env.services.adminCatalogue.createProduct(
      businessScope(c.env.businessId),
      {
        name: body.name,
        slug: body.slug,
        categoryId: body.category_id,
        shortDescription: body.short_description,
        description: body.description,
        ingredients: body.ingredients,
        allergens: body.allergens,
        dietaryTags: body.dietary_tags,
      },
      actor.userId,
    );
    return c.json(toAdminProductView(product), 201);
  });

  app.get('/products/:id', async (c) => {
    const product = await c.env.services.adminCatalogue.getProduct(
      businessScope(c.env.businessId),
      c.req.param('id'),
    );
    return c.json(toAdminProductView(product));
  });

  app.patch('/products/:id', async (c) => {
    const body = updateProductBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const product = await c.env.services.adminCatalogue.updateProduct(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.category_id !== undefined ? { categoryId: body.category_id } : {}),
        ...(body.short_description !== undefined
          ? { shortDescription: body.short_description }
          : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.ingredients !== undefined ? { ingredients: body.ingredients } : {}),
        ...(body.allergens !== undefined ? { allergens: body.allergens } : {}),
        ...(body.dietary_tags !== undefined ? { dietaryTags: body.dietary_tags } : {}),
        ...(body.is_bestseller !== undefined ? { isBestseller: body.is_bestseller } : {}),
        ...(body.is_new !== undefined ? { isNew: body.is_new } : {}),
      },
      actor.userId,
    );
    return c.json(toAdminProductView(product));
  });

  app.delete('/products/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    await c.env.services.adminCatalogue.deleteProduct(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.userId,
    );
    return c.body(null, 204);
  });

  app.post('/products/:id/status', async (c) => {
    const body = setProductStatusBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const product = await c.env.services.adminCatalogue.setProductStatus(
      businessScope(c.env.businessId),
      c.req.param('id'),
      body.status,
      actor.userId,
    );
    return c.json(toAdminProductView(product));
  });

  app.post('/products/:id/images', async (c) => {
    const body = addProductImageBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const product = await c.env.services.adminCatalogue.addProductImage(
      businessScope(c.env.businessId),
      c.req.param('id'),
      { url: body.url, altText: body.alt_text, displayOrder: body.display_order },
      actor.userId,
    );
    return c.json(toAdminProductView(product));
  });

  app.delete('/products/:id/images/:imageId', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const product = await c.env.services.adminCatalogue.removeProductImage(
      businessScope(c.env.businessId),
      c.req.param('id'),
      c.req.param('imageId'),
      actor.userId,
    );
    return c.json(toAdminProductView(product));
  });

  app.post('/products/:id/images/upload-url', async (c) => {
    const body = requestProductImageUploadBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const ticket = await c.env.services.adminCatalogue.requestProductImageUpload(
      businessScope(c.env.businessId),
      c.req.param('id'),
      { contentType: body.content_type, displayOrder: body.display_order },
      actor.userId,
    );
    return c.json({
      image_id: ticket.imageId,
      upload_url: ticket.uploadUrl,
      expires_at: ticket.expiresAt.toISOString(),
      max_bytes: ticket.maxBytes,
    });
  });

  app.post('/products/:id/images/:imageId/confirm', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const product = await c.env.services.adminCatalogue.confirmProductImageUpload(
      businessScope(c.env.businessId),
      c.req.param('id'),
      c.req.param('imageId'),
      actor.userId,
    );
    return c.json(toAdminProductView(product));
  });

  app.post('/products/:id/variants', async (c) => {
    const body = createVariantBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const variant = await c.env.services.adminCatalogue.createVariant(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        sku: body.sku,
        name: body.name,
        unit: body.unit,
        unitValue: body.unit_value,
        mrpPaise: body.mrp_paise,
        pricePaise: body.price_paise,
        taxRateBps: body.tax_rate_bps,
        isDefault: body.is_default,
        maxOrderQuantity: body.max_order_quantity,
        initialQuantityOnHand: body.initial_quantity_on_hand,
      },
      actor.userId,
    );
    return c.json(toAdminVariantView(variant), 201);
  });

  app.patch('/variants/:id', async (c) => {
    const body = updateVariantBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const variant = await c.env.services.adminCatalogue.updateVariant(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.unit_value !== undefined ? { unitValue: body.unit_value } : {}),
        ...(body.mrp_paise !== undefined ? { mrpPaise: body.mrp_paise } : {}),
        ...(body.price_paise !== undefined ? { pricePaise: body.price_paise } : {}),
        ...(body.tax_rate_bps !== undefined ? { taxRateBps: body.tax_rate_bps } : {}),
        ...(body.availability !== undefined ? { availability: body.availability } : {}),
        ...(body.is_default !== undefined ? { isDefault: body.is_default } : {}),
        ...(body.max_order_quantity !== undefined
          ? { maxOrderQuantity: body.max_order_quantity }
          : {}),
      },
      actor.userId,
    );
    return c.json(toAdminVariantView(variant));
  });

  app.delete('/variants/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    await c.env.services.adminCatalogue.deleteVariant(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.userId,
    );
    return c.body(null, 204);
  });

  app.post('/variants/:id/stock', async (c) => {
    const body = setVariantStockBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const variant = await c.env.services.adminCatalogue.setVariantStock(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        quantityOnHand: body.quantity_on_hand,
        lowStockThreshold: body.low_stock_threshold,
        allowBackorder: body.allow_backorder,
        note: body.note,
      },
      actor.userId,
    );
    return c.json(toAdminVariantView(variant));
  });

  return app;
}
