import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from './client.js';
import {
  createTestClient,
  seedBusiness,
  seedCity,
  seedPincode,
  setupTestDatabase,
  truncateAll,
} from './testing.js';

/**
 * Database constraint tests.
 *
 * These run against a REAL PostgreSQL because that is the only place the
 * constraints exist. Each test tries to write a row the business must never
 * contain and asserts the DATABASE refuses it — not the service layer, the
 * database, so the guarantee survives a future code path nobody has written
 * yet (ADR-020).
 */

let prisma: PrismaClient;

beforeAll(async () => {
  const url = await setupTestDatabase();
  prisma = createTestClient(url);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

describe('serviceability constraints', () => {
  it('rejects a pincode that is not 6 digits', async () => {
    const business = await seedBusiness(prisma);
    const city = await seedCity(prisma, business.id);

    await expect(
      prisma.servicePincode.create({
        data: { id: uuidv7(), businessId: business.id, cityId: city.id, pincode: '20130' },
      }),
    ).rejects.toThrow(/service_pincodes_format/);
  });

  it('rejects a pincode starting with zero', async () => {
    const business = await seedBusiness(prisma);
    const city = await seedCity(prisma, business.id);

    await expect(
      prisma.servicePincode.create({
        data: { id: uuidv7(), businessId: business.id, cityId: city.id, pincode: '012345' },
      }),
    ).rejects.toThrow(/service_pincodes_format/);
  });

  it('rejects the same pincode twice within one business', async () => {
    // This is what keeps serviceability deterministic: a pincode resolves to
    // exactly one city, so "is this serviceable" has exactly one answer.
    const business = await seedBusiness(prisma);
    const city = await seedCity(prisma, business.id);
    await seedPincode(prisma, business.id, city.id, { pincode: '201301' });

    await expect(
      seedPincode(prisma, business.id, city.id, { pincode: '201301' }),
    ).rejects.toThrow();
  });

  it('ALLOWS the same pincode in two different businesses', async () => {
    // Uniqueness is per business, not global. Two brands may both serve
    // 201301 without colliding (ADR-005).
    const a = await seedBusiness(prisma, { slug: 'biz-a' });
    const b = await seedBusiness(prisma, { slug: 'biz-b' });
    const cityA = await seedCity(prisma, a.id, { slug: 'city-a' });
    const cityB = await seedCity(prisma, b.id, { slug: 'city-b' });

    await seedPincode(prisma, a.id, cityA.id, { pincode: '201301' });
    await expect(seedPincode(prisma, b.id, cityB.id, { pincode: '201301' })).resolves.toBeDefined();
  });

  it('rejects an ACTIVE city with no activated_at', async () => {
    const business = await seedBusiness(prisma);

    await expect(
      prisma.city.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          name: 'X',
          slug: 'x',
          state: 'S',
          status: 'ACTIVE',
          activatedAt: null,
        },
      }),
    ).rejects.toThrow(/cities_active_requires_activated_at/);
  });

  it('rejects a blank city name', async () => {
    const business = await seedBusiness(prisma);

    await expect(
      prisma.city.create({
        data: { id: uuidv7(), businessId: business.id, name: '   ', slug: 'blank', state: 'S' },
      }),
    ).rejects.toThrow(/cities_name_not_blank/);
  });

  it('rejects a non-ISO country code', async () => {
    const business = await seedBusiness(prisma);

    await expect(
      prisma.city.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          name: 'X',
          slug: 'x2',
          state: 'S',
          country: 'India',
        },
      }),
    ).rejects.toThrow(/cities_country_iso3166/);
  });
});

describe('cross-business integrity', () => {
  it('refuses to attach a pincode to another business city', async () => {
    // The composite FK (city_id, business_id) -> cities(id, business_id).
    // A plain city_id FK would have allowed this, silently widening
    // serviceability across a tenant boundary (BR-SV3).
    const a = await seedBusiness(prisma, { slug: 'biz-x' });
    const b = await seedBusiness(prisma, { slug: 'biz-y' });
    const cityOfB = await seedCity(prisma, b.id, { slug: 'city-of-b' });

    await expect(
      prisma.servicePincode.create({
        data: {
          id: uuidv7(),
          businessId: a.id, // business A
          cityId: cityOfB.id, // city belonging to business B
          pincode: '560001',
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses to attach a variant to another business product', async () => {
    const a = await seedBusiness(prisma, { slug: 'biz-p' });
    const b = await seedBusiness(prisma, { slug: 'biz-q' });

    const categoryB = await prisma.category.create({
      data: { id: uuidv7(), businessId: b.id, name: 'Cat', slug: 'cat-b' },
    });
    const productB = await prisma.product.create({
      data: {
        id: uuidv7(),
        businessId: b.id,
        categoryId: categoryB.id,
        name: 'P',
        slug: 'p-b',
      },
    });

    await expect(
      prisma.productVariant.create({
        data: {
          id: uuidv7(),
          businessId: a.id, // business A
          productId: productB.id, // product belonging to business B
          sku: 'SKU-X',
          name: '250g',
          unit: 'g',
          unitValue: 250,
          pricePaise: 10000,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('money constraints', () => {
  async function makeVariantContext() {
    const business = await seedBusiness(prisma);
    const category = await prisma.category.create({
      data: { id: uuidv7(), businessId: business.id, name: 'C', slug: `c-${Date.now()}` },
    });
    const product = await prisma.product.create({
      data: {
        id: uuidv7(),
        businessId: business.id,
        categoryId: category.id,
        name: 'P',
        slug: `p-${Date.now()}`,
      },
    });
    return { business, product };
  }

  it('rejects a negative price', async () => {
    const { business, product } = await makeVariantContext();

    await expect(
      prisma.productVariant.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          productId: product.id,
          sku: 'NEG',
          name: 'x',
          unit: 'g',
          unitValue: 1,
          pricePaise: -1,
        },
      }),
    ).rejects.toThrow(/price_non_negative/);
  });

  it('rejects an MRP below the selling price', async () => {
    // A discount can never be negative (docs/04 §5.3).
    const { business, product } = await makeVariantContext();

    await expect(
      prisma.productVariant.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          productId: product.id,
          sku: 'MRP',
          name: 'x',
          unit: 'g',
          unitValue: 1,
          pricePaise: 20000,
          mrpPaise: 10000,
        },
      }),
    ).rejects.toThrow(/mrp_gte_price/);
  });

  it('rejects a subscription price above the one-time price', async () => {
    // Subscribing must never cost more than buying one-off.
    const { business, product } = await makeVariantContext();

    await expect(
      prisma.productVariant.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          productId: product.id,
          sku: 'SUB',
          name: 'x',
          unit: 'g',
          unitValue: 1,
          pricePaise: 10000,
          subscriptionPricePaise: 20000,
        },
      }),
    ).rejects.toThrow(/sub_price_lte_price/);
  });

  it('stores paise as BigInt without precision loss', async () => {
    const { business, product } = await makeVariantContext();

    const variant = await prisma.productVariant.create({
      data: {
        id: uuidv7(),
        businessId: business.id,
        productId: product.id,
        sku: 'BIG',
        name: 'x',
        unit: 'g',
        unitValue: 1,
        // Well beyond what a float could hold exactly.
        pricePaise: 9_007_199_254_740_993n,
      },
    });

    expect(variant.pricePaise).toBe(9_007_199_254_740_993n);
  });
});

describe('inventory constraints', () => {
  async function makeInventoryContext() {
    const business = await seedBusiness(prisma);
    const category = await prisma.category.create({
      data: { id: uuidv7(), businessId: business.id, name: 'C', slug: `ci-${Date.now()}` },
    });
    const product = await prisma.product.create({
      data: {
        id: uuidv7(),
        businessId: business.id,
        categoryId: category.id,
        name: 'P',
        slug: `pi-${Date.now()}`,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        id: uuidv7(),
        businessId: business.id,
        productId: product.id,
        sku: `SKU-${Date.now()}`,
        name: 'x',
        unit: 'g',
        unitValue: 1,
        pricePaise: 10000,
      },
    });
    return { business, variant };
  }

  it('rejects negative stock', async () => {
    const { business, variant } = await makeInventoryContext();

    await expect(
      prisma.inventory.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          variantId: variant.id,
          quantityOnHand: -1,
        },
      }),
    ).rejects.toThrow(/on_hand_non_negative/);
  });

  it('rejects reserving more than is on hand', async () => {
    // The oversell backstop (invariant 2).
    const { business, variant } = await makeInventoryContext();

    await expect(
      prisma.inventory.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          variantId: variant.id,
          quantityOnHand: 5,
          quantityReserved: 10,
        },
      }),
    ).rejects.toThrow(/reserved_within_stock/);
  });

  it('ALLOWS over-reservation when backorder is explicitly enabled', async () => {
    const { business, variant } = await makeInventoryContext();

    await expect(
      prisma.inventory.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          variantId: variant.id,
          quantityOnHand: 5,
          quantityReserved: 10,
          allowBackorder: true,
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe('append-only histories', () => {
  it('refuses to UPDATE an audit log row', async () => {
    // An audit trail that can be rewritten is not an audit trail (BR-SEC14).
    const row = await prisma.auditLog.create({
      data: {
        id: uuidv7(),
        actorType: 'SYSTEM',
        action: 'test.created',
        resourceType: 'test',
      },
    });

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'test.tampered' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to DELETE an audit log row', async () => {
    const row = await prisma.auditLog.create({
      data: {
        id: uuidv7(),
        actorType: 'SYSTEM',
        action: 'test.created',
        resourceType: 'test',
      },
    });

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe('search vector', () => {
  it('is generated automatically and stays in sync with the row', async () => {
    const business = await seedBusiness(prisma);
    const category = await prisma.category.create({
      data: { id: uuidv7(), businessId: business.id, name: 'C', slug: `cs-${Date.now()}` },
    });

    const product = await prisma.product.create({
      data: {
        id: uuidv7(),
        businessId: business.id,
        categoryId: category.id,
        name: 'Fruit Chaat Bowl',
        slug: `fcb-${Date.now()}`,
        dietaryTags: ['vegan', 'no-added-sugar'],
      },
    });

    const [before] = await prisma.$queryRaw<Array<{ sv: string }>>`
      SELECT search_vector::text AS sv FROM products WHERE id = ${product.id}::uuid
    `;
    expect(before?.sv).toContain('chaat');
    // Dietary tags are woven in via the immutable array_to_string wrapper.
    expect(before?.sv).toContain('vegan');

    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'Sprouts Salad' },
    });

    const [after] = await prisma.$queryRaw<Array<{ sv: string }>>`
      SELECT search_vector::text AS sv FROM products WHERE id = ${product.id}::uuid
    `;
    // GENERATED ALWAYS means it cannot drift from the row it describes.
    expect(after?.sv).toContain('sprout');
    expect(after?.sv).not.toContain('chaat');
  });
});
