import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Cart persistence (docs/19 "the trap being avoided").
 *
 * The cart never stores a total. Every row returned here carries the live
 * `ProductVariant` price and availability joined in, so the service layer
 * computes totals and `issues[]` fresh on every read — never from a stale
 * stored value.
 */

export type CartItemRow = {
  id: string;
  variantId: string;
  quantity: number;
  productId: string;
  productName: string;
  variantName: string;
  imageUrl: string | null;
  pricePaise: bigint;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'DISCONTINUED';
  maxOrderQuantity: number | null;
};

export type CartRow = {
  id: string;
  customerProfileId: string;
  items: CartItemRow[];
};

export interface CartRepository {
  getOrCreate(scope: BusinessScope, customerProfileId: string): Promise<CartRow>;
  addItem(
    scope: BusinessScope,
    customerProfileId: string,
    variantId: string,
    quantity: number,
  ): Promise<CartRow>;
  updateItem(
    scope: BusinessScope,
    customerProfileId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartRow>;
  removeItem(scope: BusinessScope, customerProfileId: string, itemId: string): Promise<CartRow>;
  clear(scope: BusinessScope, customerProfileId: string): Promise<void>;
}
