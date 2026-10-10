import { DomainError, newId, now, type BusinessScope, type CartRepository, type CartRow } from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

const ITEM_INCLUDE = {
  variant: {
    select: {
      id: true,
      name: true,
      pricePaise: true,
      availability: true,
      maxOrderQuantity: true,
      productId: true,
      product: {
        select: {
          name: true,
          images: { where: { variantId: null }, take: 1, orderBy: { displayOrder: 'asc' } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

type RawCart = Prisma.CartGetPayload<{ include: { items: { include: typeof ITEM_INCLUDE } } }>;

function toRow(raw: RawCart): CartRow {
  return {
    id: raw.id,
    customerProfileId: raw.customerProfileId,
    items: raw.items
      .filter((item) => item.variant !== null)
      .map((item) => ({
        id: item.id,
        variantId: item.variantId as string,
        quantity: item.quantity,
        productId: item.variant!.productId,
        productName: item.variant!.product.name,
        variantName: item.variant!.name,
        imageUrl: item.variant!.product.images[0]?.url ?? null,
        pricePaise: item.variant!.pricePaise,
        availability: item.variant!.availability,
        maxOrderQuantity: item.variant!.maxOrderQuantity,
      })),
  };
}

/** Prisma implementation of the cart (docs/19 "the trap being avoided"). One cart per customer. */
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(scope: BusinessScope, customerProfileId: string): Promise<CartRow> {
    const cart = await this.prisma.cart.upsert({
      where: { customerProfileId },
      create: { id: newId(), businessId: scope, customerProfileId },
      update: { lastActivityAt: now() },
      include: { items: { include: ITEM_INCLUDE } },
    });
    return toRow(cart);
  }

  async addItem(
    scope: BusinessScope,
    customerProfileId: string,
    variantId: string,
    quantity: number,
  ): Promise<CartRow> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, businessId: scope, deletedAt: null },
      select: { id: true },
    });
    if (!variant) throw new DomainError('VARIANT_NOT_FOUND', 'Variant not found.');

    const cart = await this.getOrCreate(scope, customerProfileId);

    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      create: { id: newId(), cartId: cart.id, variantId, quantity },
      update: { quantity: { increment: quantity } },
    });

    return this.getOrCreate(scope, customerProfileId);
  }

  async updateItem(
    scope: BusinessScope,
    customerProfileId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartRow> {
    const result = await this.prisma.cartItem.updateMany({
      where: { id: itemId, cart: { customerProfileId, businessId: scope } },
      data: { quantity },
    });
    if (result.count === 0) throw new DomainError('NOT_FOUND', 'Cart item not found.');
    return this.getOrCreate(scope, customerProfileId);
  }

  async removeItem(scope: BusinessScope, customerProfileId: string, itemId: string): Promise<CartRow> {
    await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cart: { customerProfileId, businessId: scope } },
    });
    return this.getOrCreate(scope, customerProfileId);
  }

  async clear(scope: BusinessScope, customerProfileId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({
      where: { cart: { customerProfileId, businessId: scope } },
    });
  }
}
