import type { BusinessScope } from '../domain/business-scope.js';
import type { Cursor } from '../domain/pagination.js';

/** Read-only public catalogue (docs/14 §3.2-3.3). */

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  displayOrder: number;
};

export type VariantRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  unitValue: string;
  mrpPaise: bigint | null;
  pricePaise: bigint;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'DISCONTINUED';
  isDefault: boolean;
  maxOrderQuantity: number | null;
};

export type ProductSummaryRow = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  imageUrl: string | null;
  category: { id: string; name: string; slug: string };
  dietaryTags: string[];
  isBestseller: boolean;
  isNew: boolean;
  defaultVariant: VariantRow;
};

export type ProductDetailRow = ProductSummaryRow & {
  description: string | null;
  ingredients: string | null;
  allergens: string[];
  images: Array<{ url: string; altText: string | null }>;
  variants: VariantRow[];
};

export type ListProductsFilter = {
  categoryId?: string | undefined;
  q?: string | undefined;
  limit: number;
  cursor?: Cursor | undefined;
};

export interface CatalogueRepository {
  listCategories(scope: BusinessScope): Promise<CategoryRow[]>;
  listProducts(scope: BusinessScope, filter: ListProductsFilter): Promise<ProductSummaryRow[]>;
  getProductBySlug(scope: BusinessScope, slug: string): Promise<ProductDetailRow | null>;
  getVariant(scope: BusinessScope, variantId: string): Promise<VariantRow | null>;
}
