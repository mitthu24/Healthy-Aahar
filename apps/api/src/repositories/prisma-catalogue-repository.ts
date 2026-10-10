import type {
  BusinessScope,
  CatalogueRepository,
  CategoryRow,
  ListProductsFilter,
  ProductDetailRow,
  ProductSummaryRow,
  VariantRow,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

const VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  unitValue: true,
  mrpPaise: true,
  pricePaise: true,
  availability: true,
  isDefault: true,
  maxOrderQuantity: true,
} satisfies Prisma.ProductVariantSelect;

type RawVariant = Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>;

function toVariantRow(raw: RawVariant): VariantRow {
  return {
    id: raw.id,
    sku: raw.sku,
    name: raw.name,
    unit: raw.unit,
    unitValue: raw.unitValue.toString(),
    mrpPaise: raw.mrpPaise,
    pricePaise: raw.pricePaise,
    availability: raw.availability,
    isDefault: raw.isDefault,
    maxOrderQuantity: raw.maxOrderQuantity,
  };
}

/** Read-only public catalogue (docs/14 §3.2-3.3). Published, non-deleted rows only. */
export class PrismaCatalogueRepository implements CatalogueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listCategories(scope: BusinessScope): Promise<CategoryRow[]> {
    const rows = await this.prisma.category.findMany({
      where: { businessId: scope, isActive: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.imageUrl,
      displayOrder: row.displayOrder,
    }));
  }

  async listProducts(scope: BusinessScope, filter: ListProductsFilter): Promise<ProductSummaryRow[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        businessId: scope,
        status: 'ACTIVE',
        deletedAt: null,
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.q ? { name: { contains: filter.q, mode: 'insensitive' } } : {}),
        ...(filter.cursor ? { name: { gt: filter.cursor.sortValue } } : {}),
      },
      orderBy: { name: 'asc' },
      take: filter.limit,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { deletedAt: null }, select: VARIANT_SELECT, orderBy: { displayOrder: 'asc' } },
        images: { where: { variantId: null }, take: 1, orderBy: { displayOrder: 'asc' } },
      },
    });

    return rows.flatMap((row) => {
      const defaultVariant = row.variants.find((v) => v.isDefault) ?? row.variants[0];
      if (!defaultVariant) return [];

      return [
        {
          id: row.id,
          slug: row.slug,
          name: row.name,
          shortDescription: row.shortDescription,
          imageUrl: row.images[0]?.url ?? null,
          category: row.category,
          dietaryTags: row.dietaryTags,
          isBestseller: row.isBestseller,
          isNew: row.isNew,
          defaultVariant: toVariantRow(defaultVariant),
        },
      ];
    });
  }

  async getProductBySlug(scope: BusinessScope, slug: string): Promise<ProductDetailRow | null> {
    const row = await this.prisma.product.findFirst({
      where: { businessId: scope, slug, status: 'ACTIVE', deletedAt: null },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { deletedAt: null }, select: VARIANT_SELECT, orderBy: { displayOrder: 'asc' } },
        images: { where: { variantId: null }, orderBy: { displayOrder: 'asc' } },
      },
    });

    if (!row) return null;
    const defaultVariant = row.variants.find((v) => v.isDefault) ?? row.variants[0];
    if (!defaultVariant) return null;

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      description: row.description,
      ingredients: row.ingredients,
      allergens: row.allergens,
      dietaryTags: row.dietaryTags,
      imageUrl: row.images[0]?.url ?? null,
      images: row.images.map((image) => ({ url: image.url, altText: image.altText })),
      category: row.category,
      isBestseller: row.isBestseller,
      isNew: row.isNew,
      defaultVariant: toVariantRow(defaultVariant),
      variants: row.variants.map(toVariantRow),
    };
  }

  async getVariant(scope: BusinessScope, variantId: string): Promise<VariantRow | null> {
    const row = await this.prisma.productVariant.findFirst({
      where: { id: variantId, businessId: scope, deletedAt: null },
      select: VARIANT_SELECT,
    });
    return row ? toVariantRow(row) : null;
  }
}
