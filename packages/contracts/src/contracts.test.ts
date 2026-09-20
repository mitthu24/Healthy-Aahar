import { describe, expect, it } from 'vitest';

import { pincodeSchema, moneySchema, paginationQuerySchema, phoneSchema } from './common.js';
import { ERROR_CODES, httpStatusForErrorCode } from './errors.js';
import { serviceabilityResponseSchema, createCityBodySchema } from './serviceability.js';

describe('pincodeSchema', () => {
  it('accepts a valid Indian pincode', () => {
    expect(pincodeSchema.parse('201301')).toBe('201301');
  });

  it('trims surrounding whitespace', () => {
    expect(pincodeSchema.parse('  201301  ')).toBe('201301');
  });

  it.each(['20130', '2013011', '001301', 'abcdef', ''])('rejects %s', (bad) => {
    expect(pincodeSchema.safeParse(bad).success).toBe(false);
  });

  it('matches the database CHECK constraint exactly', () => {
    // The regex here and the CHECK in the migration must agree, or the API
    // and the database will disagree about what a valid pincode is.
    const dbPattern = /^[1-9][0-9]{5}$/;
    for (const candidate of ['201301', '100001', '999999', '012345', '20130']) {
      expect(pincodeSchema.safeParse(candidate).success).toBe(dbPattern.test(candidate));
    }
  });
});

describe('phoneSchema', () => {
  it('accepts E.164', () => {
    expect(phoneSchema.parse('+919876543210')).toBe('+919876543210');
  });

  it.each(['9876543210', '+0919876543210', '919876543210', '+91 98765 43210'])(
    'rejects %s',
    (bad) => {
      expect(phoneSchema.safeParse(bad).success).toBe(false);
    },
  );
});

describe('moneySchema', () => {
  it('requires integer paise', () => {
    expect(
      moneySchema.safeParse({ amount_paise: 14950, currency: 'INR', display: '₹149.50' }).success,
    ).toBe(true);
    // A float amount must never validate — this is the schema-level half of
    // the guarantee that money is never a float (ADR-006).
    expect(
      moneySchema.safeParse({ amount_paise: 149.5, currency: 'INR', display: '₹149.50' }).success,
    ).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults the limit', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(20);
  });

  it('coerces a string limit from a query string', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('caps the limit so no caller can request an unbounded page', () => {
    expect(paginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});

describe('error codes', () => {
  it('maps every code to a valid HTTP status', () => {
    for (const code of Object.keys(ERROR_CODES) as Array<keyof typeof ERROR_CODES>) {
      const status = httpStatusForErrorCode(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('includes the serviceability codes PHASE 01 raises', () => {
    expect(ERROR_CODES.ADDRESS_NOT_SERVICEABLE).toBe(422);
    expect(ERROR_CODES.INVALID_PINCODE).toBe(422);
    expect(ERROR_CODES.CITY_INACTIVE).toBe(409);
  });
});

describe('serviceabilityResponseSchema', () => {
  it('validates a serviceable response', () => {
    const result = serviceabilityResponseSchema.safeParse({
      pincode: '201301',
      is_serviceable: true,
      reason: null,
      message: 'Good news — Healthy Aahar delivers to Sector 1-18, Noida.',
      city: {
        id: '0193aaaa-0000-7000-8000-000000000001',
        name: 'Noida',
        slug: 'noida',
        state: 'Uttar Pradesh',
      },
      area_name: 'Sector 1-18',
      waitlist_available: false,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown reason value', () => {
    const result = serviceabilityResponseSchema.safeParse({
      pincode: '201301',
      is_serviceable: false,
      reason: 'BECAUSE_I_SAID_SO',
      message: 'no',
      city: null,
      area_name: null,
      waitlist_available: true,
    });

    expect(result.success).toBe(false);
  });
});

describe('createCityBodySchema', () => {
  it('applies documented defaults', () => {
    const parsed = createCityBodySchema.parse({
      name: 'Greater Noida',
      slug: 'greater-noida',
      state: 'Uttar Pradesh',
    });

    expect(parsed.country).toBe('IN');
    expect(parsed.timezone).toBe('Asia/Kolkata');
    expect(parsed.display_order).toBe(0);
  });

  it('rejects a non-slug slug', () => {
    expect(
      createCityBodySchema.safeParse({ name: 'X', slug: 'Greater Noida', state: 'UP' }).success,
    ).toBe(false);
  });

  it('strips unknown keys so a client cannot smuggle a status field', () => {
    // Serviceability status is changed through explicit activate/deactivate
    // endpoints, never by including it in a create or update body (BR-SV5).
    const parsed = createCityBodySchema.parse({
      name: 'Noida',
      slug: 'noida',
      state: 'Uttar Pradesh',
      status: 'ACTIVE',
    } as never);

    expect('status' in parsed).toBe(false);
  });
});
