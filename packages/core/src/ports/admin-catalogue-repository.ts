import type { BusinessScope } from '../domain/business-scope.js';
import type { Cursor } from '../domain/pagination.js';

/**
 * Admin catalogue persistence (Phase 04B).
 *
 * Every write is scoped by `BusinessScope`. Soft-delete only — nothing here
 * ever issues a hard DELETE against a row another table can reference
 * (ADR consistent with the rest of the schema; `deleted_at` + the existing
 * partial unique indexes on `(business_id, slug)` are what let a slug be
 * reused after a soft-delete).
 */

export type AdminCategoryRow = {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryInput = {
  name: string;
  slug: string;
  description?: string | undefined;
  imageUrl?: string | undefined;
  displayOrder: number;
};

export type CategoryListFilter = {
  q?: string | undefined;
  isActive?: boolean | undefined;
  limit: number;
  cursor?: Cursor | undefined;
};

export type CategoryUpdateInput = Partial<{
  name: string;
  description: string | null;
  imageUrl: string | null;
  displayOrder: number;
  isActive: boolean;
}>;

export interface AdminCategoryRepository {
  list(scope: BusinessScope, filter: CategoryListFilter): Promise<AdminCategoryRow[]>;
  findById(scope: BusinessScope, id: string): Promise<AdminCategoryRow | null>;
  findBySlug(scope: BusinessScope, slug: string): Promise<AdminCategoryRow | null>;
  create(
    scope: BusinessScope,
    input: CategoryInput,
    actorUserId: string,
  ): Promise<AdminCategoryRow>;
  update(
    scope: BusinessScope,
    id: string,
    input: CategoryUpdateInput,
    actorUserId: string,
  ): Promise<AdminCategoryRow>;
  /** Soft-deletes. Caller (the service) must already have verified productCount === 0. */
  softDelete(scope: BusinessScope, id: string): Promise<void>;
}

export type AdminVariantInventoryRow = {
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  allowBackorder: boolean;
};

export type AdminVariantRow = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  unitValue: string;
  mrpPaise: bigint | null;
  pricePaise: bigint;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'DISCONTINUED';
  isDefault: boolean;
  displayOrder: number;
  maxOrderQuantity: number | null;
  inventory: AdminVariantInventoryRow | null;
};

export type VariantInput = {
  sku: string;
  name: string;
  unit: string;
  unitValue: number;
  mrpPaise?: number | undefined;
  pricePaise: number;
  isDefault?: boolean | undefined;
  maxOrderQuantity?: number | undefined;
  initialQuantityOnHand?: number | undefined;
};

export type VariantUpdateInput = Partial<{
  name: string;
  unit: string;
  unitValue: number;
  mrpPaise: number | null;
  pricePaise: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'DISCONTINUED';
  isDefault: boolean;
  maxOrderQuantity: number | null;
}>;

export interface AdminVariantRepository {
  create(scope: BusinessScope, productId: string, input: VariantInput): Promise<AdminVariantRow>;
  update(
    scope: BusinessScope,
    variantId: string,
    input: VariantUpdateInput,
  ): Promise<AdminVariantRow>;
  findById(scope: BusinessScope, variantId: string): Promise<AdminVariantRow | null>;

  /**
   * Sets on-hand stock to an ABSOLUTE value via a conditional UPDATE
   * (`quantity_on_hand = quantity_on_hand + $delta`), recording one
   * `InventoryMovement` (reason MANUAL_ADJUSTMENT). Never touches
   * `quantity_reserved` — that is owned exclusively by the checkout/
   * fulfilment flow. The DB's own CHECK constraints
   * (`inventory_on_hand_non_negative`, `inventory_reserved_within_stock`)
   * are the actual enforcement; this throws a clean `DomainError` when
   * they would be violated, e.g. setting on-hand below what is already
   * reserved without `allow_backorder`.
   */
  setStock(
    scope: BusinessScope,
    variantId: string,
    input: {
      quantityOnHand: number;
      lowStockThreshold?: number;
      allowBackorder?: boolean;
      note?: string;
    },
    actorUserId: string,
  ): Promise<AdminVariantRow>;
}

export type AdminProductImageRow = {
  id: string;
  url: string;
  altText: string | null;
  displayOrder: number;
};

export type AdminProductRow = {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  ingredients: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  categoryId: string;
  categoryName: string;
  allergens: string[];
  dietaryTags: string[];
  isBestseller: boolean;
  isNew: boolean;
  images: AdminProductImageRow[];
  variants: AdminVariantRow[];
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminProductSummaryRow = {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  categoryId: string;
  categoryName: string;
  publishedAt: Date | null;
  updatedAt: Date;
  variantCount: number;
  fromPricePaise: bigint | null;
};

export type ProductInput = {
  name: string;
  slug: string;
  categoryId: string;
  shortDescription?: string | undefined;
  description?: string | undefined;
  ingredients?: string | undefined;
  allergens: string[];
  dietaryTags: string[];
};

export type ProductUpdateInput = Partial<{
  name: string;
  categoryId: string;
  shortDescription: string | null;
  description: string | null;
  ingredients: string | null;
  allergens: string[];
  dietaryTags: string[];
  isBestseller: boolean;
  isNew: boolean;
}>;

export type ProductListFilter = {
  q?: string | undefined;
  categoryId?: string | undefined;
  status?: AdminProductRow['status'] | undefined;
  limit: number;
  cursor?: Cursor | undefined;
};

export interface AdminProductRepository {
  list(scope: BusinessScope, filter: ProductListFilter): Promise<AdminProductSummaryRow[]>;
  findById(scope: BusinessScope, id: string): Promise<AdminProductRow | null>;
  create(scope: BusinessScope, input: ProductInput, actorUserId: string): Promise<AdminProductRow>;
  update(
    scope: BusinessScope,
    id: string,
    input: ProductUpdateInput,
    actorUserId: string,
  ): Promise<AdminProductRow>;
  setStatus(
    scope: BusinessScope,
    id: string,
    status: AdminProductRow['status'],
    actorUserId: string,
  ): Promise<AdminProductRow>;
  addImage(
    scope: BusinessScope,
    productId: string,
    input: { url: string; altText?: string | undefined; displayOrder: number },
  ): Promise<AdminProductRow>;
  removeImage(scope: BusinessScope, productId: string, imageId: string): Promise<AdminProductRow>;
}
