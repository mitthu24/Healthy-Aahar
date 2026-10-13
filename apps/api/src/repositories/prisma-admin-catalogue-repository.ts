import {
  DomainError,
  newId,
  now,
  type AdminCategoryRepository,
  type AdminCategoryRow,
  type AdminProductRepository,
  type AdminProductRow,
  type AdminProductSummaryRow,
  type AdminVariantRepository,
  type AdminVariantRow,
  type BusinessScope,
  type CategoryInput,
  type CategoryListFilter,
  type CategoryUpdateInput,
  type ProductInput,
  type ProductListFilter,
  type ProductUpdateInput,
  type VariantInput,
  type VariantUpdateInput,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

import { isUniqueConstraintViolation } from './prisma-errors.js';

const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  name: true,
  unit: true,
  unitValue: true,
  mrpPaise: true,
  pricePaise: true,
  availability: true,
  isDefault: true,
  displayOrder: true,
  maxOrderQuantity: true,
  inventory: {
    where: { locationCode: 'MAIN' },
    select: {
      quantityOnHand: true,
      quantityReserved: true,
      lowStockThreshold: true,
      trackInventory: true,
      allowBackorder: true,
    },
    take: 1,
  },
} satisfies Prisma.ProductVariantSelect;

type RawVariant = Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>;

function toVariantRow(raw: RawVariant): AdminVariantRow {
  const inventory = raw.inventory[0];
  return {
    id: raw.id,
    productId: raw.productId,
    sku: raw.sku,
    name: raw.name,
    unit: raw.unit,
    unitValue: raw.unitValue.toString(),
    mrpPaise: raw.mrpPaise,
    pricePaise: raw.pricePaise,
    availability: raw.availability,
    isDefault: raw.isDefault,
    displayOrder: raw.displayOrder,
    maxOrderQuantity: raw.maxOrderQuantity,
    inventory: inventory
      ? {
          quantityOnHand: inventory.quantityOnHand,
          quantityReserved: inventory.quantityReserved,
          lowStockThreshold: inventory.lowStockThreshold,
          trackInventory: inventory.trackInventory,
          allowBackorder: inventory.allowBackorder,
        }
      : null,
  };
}

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  // PENDING (upload not yet confirmed) and FAILED images are never surfaced
  // here — only READY images have a URL guaranteed to resolve. A product
  // fetched mid-upload (e.g. the operator refreshed the page) must never
  // show a broken image link.
  images: { where: { status: 'READY' }, orderBy: { displayOrder: 'asc' } },
  variants: {
    where: { deletedAt: null },
    select: VARIANT_SELECT,
    orderBy: { displayOrder: 'asc' },
  },
} satisfies Prisma.ProductInclude;

type RawProduct = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

function toProductRow(raw: RawProduct): AdminProductRow {
  return {
    id: raw.id,
    businessId: raw.businessId,
    name: raw.name,
    slug: raw.slug,
    shortDescription: raw.shortDescription,
    description: raw.description,
    ingredients: raw.ingredients,
    status: raw.status,
    categoryId: raw.categoryId,
    categoryName: raw.category.name,
    allergens: raw.allergens,
    dietaryTags: raw.dietaryTags,
    isBestseller: raw.isBestseller,
    isNew: raw.isNew,
    images: raw.images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.altText,
      displayOrder: image.displayOrder,
    })),
    variants: raw.variants.map(toVariantRow),
    publishedAt: raw.publishedAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export class PrismaAdminCategoryRepository implements AdminCategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(scope: BusinessScope, filter: CategoryListFilter): Promise<AdminCategoryRow[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        businessId: scope,
        deletedAt: null,
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
        ...(filter.q ? { name: { contains: filter.q, mode: 'insensitive' } } : {}),
        ...(filter.cursor ? { name: { gt: filter.cursor.sortValue } } : {}),
      },
      orderBy: { name: 'asc' },
      take: filter.limit,
    });

    return Promise.all(rows.map((row) => this.toRow(row)));
  }

  async findById(scope: BusinessScope, id: string): Promise<AdminCategoryRow | null> {
    const row = await this.prisma.category.findFirst({
      where: { id, businessId: scope, deletedAt: null },
    });
    return row ? this.toRow(row) : null;
  }

  async findBySlug(scope: BusinessScope, slug: string): Promise<AdminCategoryRow | null> {
    const row = await this.prisma.category.findFirst({
      where: { slug, businessId: scope, deletedAt: null },
    });
    return row ? this.toRow(row) : null;
  }

  async create(
    scope: BusinessScope,
    input: CategoryInput,
    actorUserId: string,
  ): Promise<AdminCategoryRow> {
    try {
      const created = await this.prisma.category.create({
        data: {
          id: newId(),
          businessId: scope,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          displayOrder: input.displayOrder,
          createdBy: actorUserId,
        },
      });
      return this.toRow(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error, 'slug')) {
        throw new DomainError('SLUG_ALREADY_IN_USE', 'A category with this slug already exists.');
      }
      throw error;
    }
  }

  async update(
    scope: BusinessScope,
    id: string,
    input: CategoryUpdateInput,
    actorUserId: string,
  ): Promise<AdminCategoryRow> {
    void scope;
    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actorUserId,
        updatedAt: now(),
      },
    });
    return this.toRow(updated);
  }

  async softDelete(scope: BusinessScope, id: string): Promise<void> {
    void scope;
    await this.prisma.category.update({ where: { id }, data: { deletedAt: now() } });
  }

  private async toRow(row: {
    id: string;
    businessId: string;
    name: string;
    slug: string;
    description: string | null;
    imageUrl: string | null;
    displayOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<AdminCategoryRow> {
    const productCount = await this.prisma.product.count({
      where: { categoryId: row.id, deletedAt: null },
    });

    return {
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.imageUrl,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      productCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class PrismaAdminProductRepository implements AdminProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(scope: BusinessScope, filter: ProductListFilter): Promise<AdminProductSummaryRow[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        businessId: scope,
        deletedAt: null,
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q ? { name: { contains: filter.q, mode: 'insensitive' } } : {}),
        ...(filter.cursor ? { updatedAt: { lt: new Date(filter.cursor.sortValue) } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: filter.limit,
      include: {
        category: { select: { id: true, name: true } },
        variants: { where: { deletedAt: null }, select: { pricePaise: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      variantCount: row.variants.length,
      fromPricePaise:
        row.variants.length > 0
          ? row.variants.reduce(
              (min, v) => (v.pricePaise < min ? v.pricePaise : min),
              row.variants[0]!.pricePaise,
            )
          : null,
    }));
  }

  async findById(scope: BusinessScope, id: string): Promise<AdminProductRow | null> {
    const row = await this.prisma.product.findFirst({
      where: { id, businessId: scope, deletedAt: null },
      include: PRODUCT_INCLUDE,
    });
    return row ? toProductRow(row) : null;
  }

  async create(
    scope: BusinessScope,
    input: ProductInput,
    actorUserId: string,
  ): Promise<AdminProductRow> {
    try {
      const created = await this.prisma.product.create({
        data: {
          id: newId(),
          businessId: scope,
          categoryId: input.categoryId,
          name: input.name,
          slug: input.slug,
          shortDescription: input.shortDescription ?? null,
          description: input.description ?? null,
          ingredients: input.ingredients ?? null,
          allergens: input.allergens,
          dietaryTags: input.dietaryTags,
          status: 'DRAFT',
          createdBy: actorUserId,
        },
        include: PRODUCT_INCLUDE,
      });
      return toProductRow(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error, 'slug')) {
        throw new DomainError('SLUG_ALREADY_IN_USE', 'A product with this slug already exists.');
      }
      throw error;
    }
  }

  async update(
    scope: BusinessScope,
    id: string,
    input: ProductUpdateInput,
    actorUserId: string,
  ): Promise<AdminProductRow> {
    void scope;
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.shortDescription !== undefined
          ? { shortDescription: input.shortDescription }
          : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.ingredients !== undefined ? { ingredients: input.ingredients } : {}),
        ...(input.allergens !== undefined ? { allergens: input.allergens } : {}),
        ...(input.dietaryTags !== undefined ? { dietaryTags: input.dietaryTags } : {}),
        ...(input.isBestseller !== undefined ? { isBestseller: input.isBestseller } : {}),
        ...(input.isNew !== undefined ? { isNew: input.isNew } : {}),
        updatedBy: actorUserId,
        updatedAt: now(),
      },
      include: PRODUCT_INCLUDE,
    });
    return toProductRow(updated);
  }

  async setStatus(
    scope: BusinessScope,
    id: string,
    status: AdminProductRow['status'],
    actorUserId: string,
  ): Promise<AdminProductRow> {
    void scope;
    const existing = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      select: { publishedAt: true },
    });

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        status,
        // Stamped the first time a product goes ACTIVE; never cleared by a
        // later unpublish, so "first published" history is preserved.
        publishedAt: status === 'ACTIVE' && !existing.publishedAt ? now() : undefined,
        updatedBy: actorUserId,
        updatedAt: now(),
      },
      include: PRODUCT_INCLUDE,
    });
    return toProductRow(updated);
  }

  async addImage(
    scope: BusinessScope,
    productId: string,
    input: { url: string; altText?: string | undefined; displayOrder: number },
  ): Promise<AdminProductRow> {
    void scope;
    await this.prisma.productImage.create({
      data: {
        id: newId(),
        productId,
        storageKey: input.url,
        url: input.url,
        altText: input.altText ?? null,
        displayOrder: input.displayOrder,
        status: 'READY',
      },
    });

    const updated = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    return toProductRow(updated);
  }

  async removeImage(
    scope: BusinessScope,
    productId: string,
    imageId: string,
  ): Promise<AdminProductRow> {
    void scope;
    await this.prisma.productImage.deleteMany({ where: { id: imageId, productId } });

    const updated = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    return toProductRow(updated);
  }

  async createPendingImage(
    scope: BusinessScope,
    productId: string,
    input: { storageKey: string; url: string; altText?: string | undefined; displayOrder: number },
  ): Promise<{ id: string }> {
    void scope;
    const id = newId();
    await this.prisma.productImage.create({
      data: {
        id,
        productId,
        storageKey: input.storageKey,
        url: input.url,
        altText: input.altText ?? null,
        displayOrder: input.displayOrder,
        status: 'PENDING',
      },
    });
    return { id };
  }

  async findImage(
    scope: BusinessScope,
    productId: string,
    imageId: string,
  ): Promise<{ id: string; storageKey: string; status: 'PENDING' | 'READY' | 'FAILED' } | null> {
    void scope;
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
      select: { id: true, storageKey: true, status: true },
    });
    return image;
  }

  async confirmImage(
    scope: BusinessScope,
    productId: string,
    imageId: string,
    input: { width?: number | undefined; height?: number | undefined },
  ): Promise<AdminProductRow> {
    void scope;
    await this.prisma.productImage.updateMany({
      where: { id: imageId, productId },
      data: {
        status: 'READY',
        width: input.width ?? null,
        height: input.height ?? null,
      },
    });

    const updated = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    return toProductRow(updated);
  }
}

export class PrismaAdminVariantRepository implements AdminVariantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    scope: BusinessScope,
    productId: string,
    input: VariantInput,
  ): Promise<AdminVariantRow> {
    const created = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          id: newId(),
          businessId: scope,
          productId,
          sku: input.sku,
          name: input.name,
          unit: input.unit,
          unitValue: input.unitValue,
          mrpPaise: input.mrpPaise !== undefined ? BigInt(input.mrpPaise) : null,
          pricePaise: BigInt(input.pricePaise),
          isDefault: input.isDefault ?? false,
          maxOrderQuantity: input.maxOrderQuantity ?? null,
        },
      });

      await tx.inventory.create({
        data: {
          id: newId(),
          businessId: scope,
          variantId: variant.id,
          locationCode: 'MAIN',
          quantityOnHand: input.initialQuantityOnHand ?? 0,
          quantityReserved: 0,
          trackInventory: true,
          allowBackorder: false,
        },
      });

      return tx.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        select: VARIANT_SELECT,
      });
    });

    return toVariantRow(created);
  }

  async update(
    scope: BusinessScope,
    variantId: string,
    input: VariantUpdateInput,
  ): Promise<AdminVariantRow> {
    void scope;
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.unitValue !== undefined ? { unitValue: input.unitValue } : {}),
        ...(input.mrpPaise !== undefined
          ? { mrpPaise: input.mrpPaise !== null ? BigInt(input.mrpPaise) : null }
          : {}),
        ...(input.pricePaise !== undefined ? { pricePaise: BigInt(input.pricePaise) } : {}),
        ...(input.availability !== undefined ? { availability: input.availability } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.maxOrderQuantity !== undefined
          ? { maxOrderQuantity: input.maxOrderQuantity }
          : {}),
        updatedAt: now(),
      },
      select: VARIANT_SELECT,
    });
    return toVariantRow(updated);
  }

  async findById(scope: BusinessScope, variantId: string): Promise<AdminVariantRow | null> {
    const row = await this.prisma.productVariant.findFirst({
      where: { id: variantId, businessId: scope, deletedAt: null },
      select: VARIANT_SELECT,
    });
    return row ? toVariantRow(row) : null;
  }

  async setStock(
    scope: BusinessScope,
    variantId: string,
    input: {
      quantityOnHand: number;
      lowStockThreshold?: number;
      allowBackorder?: boolean;
      note?: string;
    },
    actorUserId: string,
  ): Promise<AdminVariantRow> {
    const businessId: string = scope;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.inventory.findUnique({
        where: { variantId_locationCode: { variantId, locationCode: 'MAIN' } },
      });

      if (!existing) {
        const created = await tx.inventory.create({
          data: {
            id: newId(),
            businessId,
            variantId,
            locationCode: 'MAIN',
            quantityOnHand: input.quantityOnHand,
            quantityReserved: 0,
            lowStockThreshold: input.lowStockThreshold ?? 0,
            allowBackorder: input.allowBackorder ?? false,
          },
        });

        // A genuine zero initial stock is not a movement — nothing changed
        // from the (nonexistent) prior state — and would otherwise violate
        // `inventory_movements_delta_non_zero` (quantity_delta and
        // reserved_delta both 0). Same guard the update branch below
        // already applies for a no-op stock set.
        if (input.quantityOnHand !== 0) {
          await tx.inventoryMovement.create({
            data: {
              id: newId(),
              inventoryId: created.id,
              variantId,
              reason: 'MANUAL_ADJUSTMENT',
              quantityDelta: input.quantityOnHand,
              quantityAfter: input.quantityOnHand,
              note: input.note ?? 'Initial stock set by admin',
              actorUserId,
            },
          });
        }
        return;
      }

      // Conditional UPDATE mirrors the DB's own CHECK constraint
      // (`inventory_reserved_within_stock`) so a row that would violate it
      // affects ZERO rows instead of throwing a raw Postgres error — the
      // same lost-update-safe pattern checkout uses for reservation.
      const allowBackorder = input.allowBackorder ?? existing.allowBackorder;
      const affected: number = await tx.$executeRaw`
        UPDATE inventory
        SET quantity_on_hand = ${input.quantityOnHand},
            low_stock_threshold = ${input.lowStockThreshold ?? existing.lowStockThreshold},
            allow_backorder = ${allowBackorder},
            updated_at = now()
        WHERE variant_id = ${variantId}::uuid AND location_code = 'MAIN' AND business_id = ${businessId}::uuid
          AND (${allowBackorder} = true OR quantity_reserved <= ${input.quantityOnHand})
      `;

      if (affected === 0) {
        throw new DomainError(
          'STOCK_BELOW_RESERVED',
          `Cannot set stock to ${input.quantityOnHand}: ${existing.quantityReserved} unit(s) are already reserved for pending orders.`,
        );
      }

      const delta = input.quantityOnHand - existing.quantityOnHand;
      if (delta !== 0) {
        await tx.inventoryMovement.create({
          data: {
            id: newId(),
            inventoryId: existing.id,
            variantId,
            reason: 'MANUAL_ADJUSTMENT',
            quantityDelta: delta,
            quantityAfter: input.quantityOnHand,
            note: input.note ?? null,
            actorUserId,
          },
        });
      }
    });

    const updated = await this.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: VARIANT_SELECT,
    });
    return toVariantRow(updated);
  }
}
