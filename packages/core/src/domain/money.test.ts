import { describe, expect, it } from 'vitest';

import {
  addPaise,
  applyBasisPoints,
  formatPaise,
  money,
  MoneyError,
  multiplyPaise,
  percentageDiscount,
  roundHalfUp,
  rupeesToPaise,
  subtractPaise,
} from './money.js';

describe('formatPaise', () => {
  it('formats whole rupees', () => {
    expect(formatPaise(14900)).toBe('₹149.00');
  });

  it('formats paise remainders', () => {
    expect(formatPaise(14950)).toBe('₹149.50');
    expect(formatPaise(1)).toBe('₹0.01');
  });

  it('uses Indian lakh grouping', () => {
    // 12,345.67 — not 12,345.67 with thousands grouping
    expect(formatPaise(1234567)).toBe('₹12,345.67');
    expect(formatPaise(10000000)).toBe('₹1,00,000.00');
  });

  it('formats negative amounts for refunds and discounts', () => {
    expect(formatPaise(-14900)).toBe('-₹149.00');
  });

  it('formats zero', () => {
    expect(formatPaise(0)).toBe('₹0.00');
  });
});

describe('money', () => {
  it('produces the documented API shape', () => {
    expect(money(32700)).toEqual({
      amount_paise: 32700,
      currency: 'INR',
      display: '₹327.00',
    });
  });

  it('rejects a fractional amount', () => {
    // The whole point of integer paise: a float can never enter the system.
    expect(() => money(149.5)).toThrow(MoneyError);
    expect(() => money(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => money(Number.NaN)).toThrow(MoneyError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds exactly where floats would drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point. In paise it is exact.
    expect(addPaise(10, 20)).toBe(30);
    expect(addPaise(3333, 3333, 3333)).toBe(9999);
  });

  it('multiplies a line total exactly', () => {
    // ₹33.33 x 3 must be ₹99.99, never ₹99.98.
    expect(multiplyPaise(3333, 3)).toBe(9999);
    expect(formatPaise(multiplyPaise(3333, 3))).toBe('₹99.99');
  });

  it('subtracts, allowing a negative result for refunds', () => {
    expect(subtractPaise(10000, 12000)).toBe(-2000);
  });

  it('rejects a fractional quantity', () => {
    expect(() => multiplyPaise(14900, 1.5)).toThrow(MoneyError);
  });

  it('rejects a negative quantity', () => {
    expect(() => multiplyPaise(14900, -1)).toThrow(MoneyError);
  });
});

describe('roundHalfUp', () => {
  it('rounds .5 away from zero in both directions', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
    // Math.round(-0.5) is -0, which is not half-up. This is why the helper
    // exists rather than calling Math.round directly.
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(-1.5)).toBe(-2);
  });
});

describe('applyBasisPoints', () => {
  it('applies a percentage discount', () => {
    // 15% of ₹149.00
    expect(applyBasisPoints(14900, 1500)).toBe(2235);
  });

  it('rounds half-up at the line level', () => {
    expect(applyBasisPoints(333, 500)).toBe(17); // 16.65 -> 17
  });

  it('handles 0% and 100%', () => {
    expect(applyBasisPoints(14900, 0)).toBe(0);
    expect(applyBasisPoints(14900, 10000)).toBe(14900);
  });

  it('rejects negative basis points', () => {
    expect(() => applyBasisPoints(14900, -100)).toThrow(MoneyError);
  });
});

describe('percentageDiscount', () => {
  it('computes the display discount percentage', () => {
    expect(percentageDiscount(17900, 14900)).toBe(17);
  });

  it('returns 0 when the price is not below MRP', () => {
    expect(percentageDiscount(14900, 14900)).toBe(0);
    expect(percentageDiscount(14900, 15900)).toBe(0);
    expect(percentageDiscount(0, 14900)).toBe(0);
  });
});

describe('rupeesToPaise', () => {
  it('converts at the input boundary', () => {
    expect(rupeesToPaise('149.50')).toBe(14950);
    expect(rupeesToPaise(149.5)).toBe(14950);
    expect(rupeesToPaise('0.01')).toBe(1);
  });

  it('rounds a sub-paise input rather than truncating it', () => {
    expect(rupeesToPaise('149.999')).toBe(15000);
  });

  it('rejects a non-numeric input', () => {
    expect(() => rupeesToPaise('abc')).toThrow(MoneyError);
  });
});
