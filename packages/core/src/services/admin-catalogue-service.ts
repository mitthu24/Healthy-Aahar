import { isAllowedImageType, type StoragePort } from '@healthy-aahar/storage';

import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { buildPage, decodeCursor } from '../domain/pagination.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  AdminCategoryRepository,
  AdminProductRepository,
  AdminVariantRepository,
  CategoryInput,
  CategoryUpdateInput,
  ProductInput,
  ProductUpdateInput,
  VariantInput,
  VariantUpdateInput,
} from '../ports/admin-catalogue-repository.js';

export type AdminCatalogueServiceDeps = {
  categories: AdminCategoryRepository;
  products: AdminProductRepository;
  variants: AdminVariantRepository;
  audit: AuditLogRepository;
  storage: StoragePort;
  maxUploadBytes: number;
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Admin catalogue management (Phase 04B).
 *
 * This is the ONLY place catalogue business rules are enforced for admin
 * writes — the route layer parses/authenticates, this layer decides. It
 * reuses the Phase 02 schema and the Phase 04 public catalogue read path
 * verbatim; nothing here adds a table, a migration, or a second notion of
 * "is this product visible" (that remains `status === 'ACTIVE'`, checked by
 * the public routes, untouched).
 */
export class AdminCatalogueService {
  private readonly categories: AdminCategoryRepository;
  private readonly products: AdminProductRepository;
  private readonly variants: AdminVariantRepository;
  private readonly audit: AuditLogRepository;
  private readonly storage: StoragePort;
  private readonly maxUploadBytes: number;

  constructor({
    categories,
    products,
    variants,
    audit,
    storage,
    maxUploadBytes,
  }: AdminCatalogueServiceDeps) {
    this.categories = categories;
    this.products = products;
    this.variants = variants;
    this.audit = audit;
    this.storage = storage;
    this.maxUploadBytes = maxUploadBytes;
  }

  // ── Categories ───────────────────────────────────────────────────────

  async listCategories(
    scope: BusinessScope,
    filter: { q?: string; isActive?: boolean; limit: number; cursor?: string },
  ) {
    const rows = await this.categories.list(scope, {
      limit: filter.limit + 1,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      q: filter.q,
      isActive: filter.isActive,
    });
    return buildPage(rows, filter.limit, (row) => ({ sortValue: row.name, id: row.id }));
  }

  async getCategory(scope: BusinessScope, id: string) {
    const category = await this.categories.findById(scope, id);
    if (!category) throw new DomainError('CATEGORY_NOT_FOUND', 'Category not found.');
    return category;
  }

  async createCategory(scope: BusinessScope, input: CategoryInput, actorUserId: string) {
    const existing = await this.categories.findBySlug(scope, input.slug);
    if (existing) {
      throw new DomainError('SLUG_ALREADY_IN_USE', 'A category with this slug already exists.', {
        details: [{ field: 'slug', issue: 'already in use' }],
      });
    }

    const created = await this.categories.create(scope, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'category.created',
      resourceType: 'category',
      resourceId: created.id,
      metadata: { name: created.name, slug: created.slug },
    });

    return created;
  }

  async updateCategory(
    scope: BusinessScope,
    id: string,
    input: CategoryUpdateInput,
    actorUserId: string,
  ) {
    await this.getCategory(scope, id);
    const updated = await this.categories.update(scope, id, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'category.updated',
      resourceType: 'category',
      resourceId: id,
      metadata: input,
    });

    return updated;
  }

  async deleteCategory(scope: BusinessScope, id: string, actorUserId: string) {
    const category = await this.getCategory(scope, id);
    if (category.productCount > 0) {
      throw new DomainError(
        'CATEGORY_HAS_PRODUCTS',
        `This category has ${category.productCount} product(s). Reassign or archive them before deleting it.`,
      );
    }

    await this.categories.softDelete(scope, id);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'category.deleted',
      resourceType: 'category',
      resourceId: id,
    });
  }

  // ── Products ─────────────────────────────────────────────────────────

  async listProducts(
    scope: BusinessScope,
    filter: {
      q?: string;
      categoryId?: string;
      status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
      limit: number;
      cursor?: string;
    },
  ) {
    const rows = await this.products.list(scope, {
      limit: filter.limit + 1,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      q: filter.q,
      categoryId: filter.categoryId,
      status: filter.status,
    });
    return buildPage(rows, filter.limit, (row) => ({
      sortValue: row.updatedAt.toISOString(),
      id: row.id,
    }));
  }

  async getProduct(scope: BusinessScope, id: string) {
    const product = await this.products.findById(scope, id);
    if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found.');
    return product;
  }

  async createProduct(scope: BusinessScope, input: ProductInput, actorUserId: string) {
    const category = await this.categories.findById(scope, input.categoryId);
    if (!category) throw new DomainError('CATEGORY_NOT_FOUND', 'Category not found.');

    const created = await this.products.create(scope, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.created',
      resourceType: 'product',
      resourceId: created.id,
      metadata: { name: created.name, slug: created.slug },
    });

    return created;
  }

  async updateProduct(
    scope: BusinessScope,
    id: string,
    input: ProductUpdateInput,
    actorUserId: string,
  ) {
    await this.getProduct(scope, id);

    if (input.categoryId) {
      const category = await this.categories.findById(scope, input.categoryId);
      if (!category) throw new DomainError('CATEGORY_NOT_FOUND', 'Category not found.');
    }

    const updated = await this.products.update(scope, id, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.updated',
      resourceType: 'product',
      resourceId: id,
      metadata: input,
    });

    return updated;
  }

  /**
   * ACTIVE is the only status the public catalogue reads (unchanged,
   * docs/14 §3.2). A product cannot go live with nothing to sell — this is
   * the one guard the acceptance journey relies on: create category,
   * create product + variant, set price/stock, publish, see it in the
   * public catalogue. Going DRAFT/INACTIVE/ARCHIVED has no such guard.
   */
  async setProductStatus(
    scope: BusinessScope,
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    actorUserId: string,
  ) {
    const product = await this.getProduct(scope, id);

    if (status === 'ACTIVE' && product.variants.length === 0) {
      throw new DomainError(
        'PRODUCT_NOT_PUBLISHABLE',
        'Add at least one variant with a price before publishing this product.',
      );
    }

    const updated = await this.products.setStatus(scope, id, status, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.status_changed',
      resourceType: 'product',
      resourceId: id,
      metadata: { from: product.status, to: status },
    });

    return updated;
  }

  async addProductImage(
    scope: BusinessScope,
    productId: string,
    input: { url: string; altText?: string; displayOrder: number },
    actorUserId: string,
  ) {
    await this.getProduct(scope, productId);
    const updated = await this.products.addImage(scope, productId, input);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.image_added',
      resourceType: 'product',
      resourceId: productId,
      metadata: { url: input.url },
    });

    return updated;
  }

  async removeProductImage(
    scope: BusinessScope,
    productId: string,
    imageId: string,
    actorUserId: string,
  ) {
    await this.getProduct(scope, productId);
    // Look up BEFORE deleting the row — need the storageKey to also clean
    // up the object store, and `removeImage` itself returns the product
    // view, not the deleted row.
    const existing = await this.products.findImage(scope, productId, imageId);
    const updated = await this.products.removeImage(scope, productId, imageId);

    // A pasted-URL image (addProductImage) stores the URL itself as the
    // "storage key" — nothing for this service to own or delete from an
    // object store. Only a real device-uploaded image's key is ours to
    // delete; `addImage`'s own write always sets the key to an
    // `https://...` URL, while `createPendingImage` always sets it to a
    // server-generated path (never starting with a scheme) — the two paths'
    // own invariants make this check exact, not a heuristic.
    if (existing && !existing.storageKey.startsWith('http')) {
      await this.storage.delete(existing.storageKey);
    }

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.image_removed',
      resourceType: 'product',
      resourceId: productId,
      metadata: { imageId },
    });

    return updated;
  }

  /**
   * Step 1 of the device-upload flow (PHASE 05): creates a PENDING image
   * row against a server-generated storage key and returns a short-lived
   * presigned PUT URL. The caller (the admin app) uploads the file bytes
   * directly to that URL — this service and the API never see the bytes.
   */
  async requestProductImageUpload(
    scope: BusinessScope,
    productId: string,
    input: { contentType: string; displayOrder: number },
    actorUserId: string,
  ) {
    await this.getProduct(scope, productId);

    if (!isAllowedImageType(input.contentType)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Unsupported image type "${input.contentType}". Allowed: image/jpeg, image/png, image/webp, image/avif.`,
      );
    }
    const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType]!;

    const presigned = await this.storage.presignUpload({
      prefix: `products/${productId}`,
      contentType: input.contentType,
      extension,
    });

    const { id: imageId } = await this.products.createPendingImage(scope, productId, {
      storageKey: presigned.storageKey,
      url: this.storage.publicUrl(presigned.storageKey),
      displayOrder: input.displayOrder,
    });

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.image_upload_requested',
      resourceType: 'product',
      resourceId: productId,
      metadata: { imageId, storageKey: presigned.storageKey },
    });

    return {
      imageId,
      uploadUrl: presigned.uploadUrl,
      expiresAt: presigned.expiresAt,
      maxBytes: this.maxUploadBytes,
    };
  }

  /**
   * Step 2: the admin app calls this once its direct upload to R2/MinIO
   * finishes. Independently re-verifies what actually landed in storage —
   * never trusts the client's say-so that the upload succeeded or was the
   * right size — before marking the image READY (visible on the product).
   * On any failure, the PENDING row and (if present) the stored object are
   * both cleaned up rather than left behind as orphaned/broken state.
   */
  async confirmProductImageUpload(
    scope: BusinessScope,
    productId: string,
    imageId: string,
    actorUserId: string,
  ) {
    await this.getProduct(scope, productId);

    const image = await this.products.findImage(scope, productId, imageId);
    if (!image) {
      throw new DomainError('IMAGE_NOT_FOUND', 'Image not found for this product.');
    }
    if (image.status !== 'PENDING') {
      throw new DomainError(
        'VALIDATION_FAILED',
        `This image has already been ${image.status === 'READY' ? 'confirmed' : 'rejected'}.`,
      );
    }

    const stored = await this.storage.headObject(image.storageKey);
    const failure = !stored
      ? 'nothing was uploaded to the expected location'
      : !isAllowedImageType(stored.contentType ?? '')
        ? `uploaded content type "${stored.contentType ?? 'unknown'}" is not an allowed image type`
        : stored.sizeBytes > this.maxUploadBytes
          ? `uploaded file (${stored.sizeBytes} bytes) exceeds the ${this.maxUploadBytes}-byte limit`
          : undefined;

    if (failure) {
      if (stored) await this.storage.delete(image.storageKey);
      await this.products.removeImage(scope, productId, imageId);
      throw new DomainError('VALIDATION_FAILED', `Upload could not be confirmed: ${failure}.`);
    }

    const updated = await this.products.confirmImage(scope, productId, imageId, {});

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'product.image_upload_confirmed',
      resourceType: 'product',
      resourceId: productId,
      metadata: { imageId },
    });

    return updated;
  }

  // ── Variants ─────────────────────────────────────────────────────────

  async createVariant(
    scope: BusinessScope,
    productId: string,
    input: VariantInput,
    actorUserId: string,
  ) {
    await this.getProduct(scope, productId);

    if (input.mrpPaise !== undefined && input.mrpPaise < input.pricePaise) {
      throw new DomainError('VALIDATION_FAILED', 'MRP cannot be lower than the selling price.', {
        details: [{ field: 'mrp_paise', issue: 'must be >= price_paise' }],
      });
    }

    const created = await this.variants.create(scope, productId, input);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'variant.created',
      resourceType: 'product_variant',
      resourceId: created.id,
      metadata: { productId, sku: created.sku },
    });

    return created;
  }

  async updateVariant(
    scope: BusinessScope,
    variantId: string,
    input: VariantUpdateInput,
    actorUserId: string,
  ) {
    const existing = await this.getVariant(scope, variantId);

    const nextMrp =
      input.mrpPaise !== undefined
        ? input.mrpPaise
        : existing.mrpPaise
          ? Number(existing.mrpPaise)
          : null;
    const nextPrice = input.pricePaise ?? Number(existing.pricePaise);
    if (nextMrp !== null && nextMrp < nextPrice) {
      throw new DomainError('VALIDATION_FAILED', 'MRP cannot be lower than the selling price.', {
        details: [{ field: 'mrp_paise', issue: 'must be >= price_paise' }],
      });
    }

    const updated = await this.variants.update(scope, variantId, input);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'variant.updated',
      resourceType: 'product_variant',
      resourceId: variantId,
      metadata: input,
    });

    return updated;
  }

  async setVariantStock(
    scope: BusinessScope,
    variantId: string,
    input: {
      quantityOnHand: number;
      lowStockThreshold?: number;
      allowBackorder?: boolean;
      note?: string;
    },
    actorUserId: string,
  ) {
    await this.getVariant(scope, variantId);
    const updated = await this.variants.setStock(scope, variantId, input, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'variant.stock_set',
      resourceType: 'product_variant',
      resourceId: variantId,
      metadata: { quantityOnHand: input.quantityOnHand, note: input.note },
    });

    return updated;
  }

  private async getVariant(scope: BusinessScope, variantId: string) {
    const variant = await this.variants.findById(scope, variantId);
    if (!variant) throw new DomainError('VARIANT_NOT_FOUND', 'Variant not found.');
    return variant;
  }
}
