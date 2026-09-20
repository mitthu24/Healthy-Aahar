/**
 * Money.
 *
 * All amounts are integer **paise**. Never a float, never a string, never a
 * rupee-denominated number (ADR-006, BR-P9).
 *
 * Formatting happens exactly once, here. No component, route or report may
 * format currency itself — that is how "₹149" and "Rs. 149.00" end up on the
 * same screen.
 */

export type Currency = 'INR';

export type Money = {
  amount_paise: number;
  currency: Currency;
  display: string;
};

const PAISE_PER_RUPEE = 100;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertSafePaise(paise: number): void {
  if (!Number.isFinite(paise)) {
    throw new MoneyError(`Amount must be finite, received ${paise}`);
  }
  if (!Number.isInteger(paise)) {
    throw new MoneyError(
      `Amount must be an integer number of paise, received ${paise}. ` +
        'Money is never fractional paise — see docs/04-DATABASE-DESIGN.md §1.2.',
    );
  }
  if (!Number.isSafeInteger(paise)) {
    throw new MoneyError(`Amount ${paise} exceeds the safe integer range`);
  }
}

/** Format paise as Indian currency with lakh/crore grouping. */
export function formatPaise(paise: number, currency: Currency = 'INR'): string {
  assertSafePaise(paise);

  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / PAISE_PER_RUPEE);
  const remainder = absolute % PAISE_PER_RUPEE;

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees + remainder / PAISE_PER_RUPEE);

  const symbol = currency === 'INR' ? '₹' : '';
  return `${negative ? '-' : ''}${symbol}${formatted}`;
}

export function money(paise: number, currency: Currency = 'INR'): Money {
  assertSafePaise(paise);
  return { amount_paise: paise, currency, display: formatPaise(paise, currency) };
}

export const zeroMoney = (currency: Currency = 'INR'): Money => money(0, currency);

export function addPaise(...amounts: number[]): number {
  return amounts.reduce((sum, amount) => {
    assertSafePaise(amount);
    return sum + amount;
  }, 0);
}

export function subtractPaise(minuend: number, subtrahend: number): number {
  assertSafePaise(minuend);
  assertSafePaise(subtrahend);
  return minuend - subtrahend;
}

export function multiplyPaise(paise: number, quantity: number): number {
  assertSafePaise(paise);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer, received ${quantity}`);
  }
  return paise * quantity;
}

/**
 * Round half-up, the convention used for every money calculation in this
 * system. Banker's rounding would be defensible, but consistency matters more
 * than the choice: line totals are rounded individually and the order total is
 * their sum, so the invoice always adds up (ADR-006).
 *
 * Note `Math.round` rounds -0.5 toward zero, which is not half-up for negative
 * values — discounts and refunds are negative, so this is handled explicitly.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Apply a percentage expressed in basis points. 1500 bps = 15%. */
export function applyBasisPoints(paise: number, basisPoints: number): number {
  assertSafePaise(paise);
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`Basis points must be a non-negative integer, received ${basisPoints}`);
  }
  return roundHalfUp((paise * basisPoints) / 10_000);
}

export function percentageDiscount(mrpPaise: number, pricePaise: number): number {
  assertSafePaise(mrpPaise);
  assertSafePaise(pricePaise);
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return 0;
  return Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

/** Parse a rupee string ("149.50") into paise. Input boundaries only —
 *  never use this on a value that is already paise. */
export function rupeesToPaise(rupees: string | number): number {
  const value = typeof rupees === 'string' ? Number(rupees) : rupees;
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Cannot convert ${String(rupees)} to paise`);
  }
  return roundHalfUp(value * PAISE_PER_RUPEE);
}
