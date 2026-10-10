import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { addPaise, money, multiplyPaise, type Money } from '../domain/money.js';
import type { CartRepository, CartRow } from '../ports/cart-repository.js';

export type CartServiceDeps = { carts: CartRepository };

export type CartIssue = {
  item_id: string;
  code: 'PRICE_CHANGED' | 'OUT_OF_STOCK' | 'MAX_QUANTITY_EXCEEDED' | 'ITEM_UNAVAILABLE';
  message: string;
};

export type CartView = {
  id: string;
  items: Array<{
    id: string;
    variant_id: string;
    product_id: string;
    product_name: string;
    variant_name: string;
    image_url: string | null;
    unit_price: Money;
    quantity: number;
    line_total: Money;
  }>;
  subtotal: Money;
  issues: CartIssue[];
  item_count: number;
};

/**
 * Cart (docs/19 "the trap being avoided").
 *
 * `view()` is the one place a cart becomes a response: it recomputes every
 * line against the live variant price and availability and reports any
 * mismatch as an `issue` rather than silently charging a different amount
 * later, at checkout, which already re-validates independently.
 */
export class CartService {
  private readonly carts: CartRepository;

  constructor({ carts }: CartServiceDeps) {
    this.carts = carts;
  }

  async view(scope: BusinessScope, customerProfileId: string): Promise<CartView> {
    const cart = await this.carts.getOrCreate(scope, customerProfileId);
    return this.toView(cart);
  }

  async addItem(
    scope: BusinessScope,
    customerProfileId: string,
    variantId: string,
    quantity: number,
  ): Promise<CartView> {
    const cart = await this.carts.addItem(scope, customerProfileId, variantId, quantity);
    return this.toView(cart);
  }

  async updateItem(
    scope: BusinessScope,
    customerProfileId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartView> {
    const cart = await this.carts.updateItem(scope, customerProfileId, itemId, quantity);
    return this.toView(cart);
  }

  async removeItem(scope: BusinessScope, customerProfileId: string, itemId: string): Promise<CartView> {
    const cart = await this.carts.removeItem(scope, customerProfileId, itemId);
    return this.toView(cart);
  }

  private toView(cart: CartRow): CartView {
    const issues: CartIssue[] = [];
    const items = cart.items.map((item) => {
      if (item.availability !== 'AVAILABLE') {
        issues.push({
          item_id: item.id,
          code: 'OUT_OF_STOCK',
          message: `${item.productName} is currently unavailable.`,
        });
      } else if (item.maxOrderQuantity !== null && item.quantity > item.maxOrderQuantity) {
        issues.push({
          item_id: item.id,
          code: 'MAX_QUANTITY_EXCEEDED',
          message: `Only ${item.maxOrderQuantity} of ${item.productName} may be ordered at once.`,
        });
      }

      const unitPricePaise = Number(item.pricePaise);
      return {
        id: item.id,
        variant_id: item.variantId,
        product_id: item.productId,
        product_name: item.productName,
        variant_name: item.variantName,
        image_url: item.imageUrl,
        unit_price: money(unitPricePaise),
        quantity: item.quantity,
        line_total: money(multiplyPaise(unitPricePaise, item.quantity)),
      };
    });

    const subtotalPaise = addPaise(...items.map((item) => item.line_total.amount_paise));

    return {
      id: cart.id,
      items,
      subtotal: money(subtotalPaise),
      issues,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }
}

export function assertKnownQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new DomainError('INVALID_QUANTITY', 'Quantity must be a whole number between 1 and 99.');
  }
}
