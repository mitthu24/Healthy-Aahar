/**
 * Cart item-count, kept in memory so the header badge updates instantly
 * after an add/remove without every component re-fetching the cart
 * (mirrors `session-store.ts`'s subscribe pattern).
 */
let itemCount = 0;
const listeners = new Set<() => void>();

export function getCartItemCount(): number {
  return itemCount;
}

export function setCartItemCount(next: number): void {
  itemCount = next;
  for (const listener of listeners) listener();
}

export function subscribeCartItemCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
