import { money } from '../domain/money.js';
import type {
  AdminCategoryRow,
  AdminProductRow,
  AdminProductSummaryRow,
  AdminVariantRow,
} from '../ports/admin-catalogue-repository.js';

export function toAdminCategoryView(row: AdminCategoryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image_url: row.imageUrl,
    display_order: row.displayOrder,
    is_active: row.isActive,
    product_count: row.productCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toAdminVariantView(row: AdminVariantRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    unit_value: row.unitValue,
    mrp: row.mrpPaise !== null ? money(Number(row.mrpPaise)) : null,
    price: money(Number(row.pricePaise)),
    availability: row.availability,
    is_default: row.isDefault,
    display_order: row.displayOrder,
    max_order_quantity: row.maxOrderQuantity,
    inventory: row.inventory
      ? {
          quantity_on_hand: row.inventory.quantityOnHand,
          quantity_reserved: row.inventory.quantityReserved,
          quantity_available: row.inventory.quantityOnHand - row.inventory.quantityReserved,
          low_stock_threshold: row.inventory.lowStockThreshold,
          track_inventory: row.inventory.trackInventory,
          allow_backorder: row.inventory.allowBackorder,
        }
      : null,
  };
}

export function toAdminProductView(row: AdminProductRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    short_description: row.shortDescription,
    description: row.description,
    status: row.status,
    category: { id: row.categoryId, name: row.categoryName },
    allergens: row.allergens,
    dietary_tags: row.dietaryTags,
    is_bestseller: row.isBestseller,
    is_new: row.isNew,
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt_text: image.altText,
      display_order: image.displayOrder,
    })),
    variants: row.variants.map(toAdminVariantView),
    published_at: row.publishedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toAdminProductSummaryView(row: AdminProductSummaryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    category: { id: row.categoryId, name: row.categoryName },
    published_at: row.publishedAt?.toISOString() ?? null,
    updated_at: row.updatedAt.toISOString(),
    variant_count: row.variantCount,
    from_price: row.fromPricePaise !== null ? money(Number(row.fromPricePaise)) : null,
  };
}
