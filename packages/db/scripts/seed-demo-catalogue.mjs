#!/usr/bin/env node
/**
 * STAGING-ONLY demo catalogue seed (Phase 04B).
 *
 * This is NOT part of `prisma/seed.ts` and never runs automatically — that
 * seed deliberately creates no products (see its own comments): a business's
 * real catalogue is owned by the admin panel built in this phase, not by a
 * script. This file exists only so a staging/demo environment can have a
 * few genuine, admin-manageable products to look at without someone
 * hand-typing them through the UI first.
 *
 * Safety:
 *   - REFUSES to run when APP_ENV=production. There is no --force override
 *     here (unlike prisct/seed.ts) because there is no legitimate reason to
 *     ever run synthetic demo products against production — this script
 *     invents nothing a real business would want served to real customers.
 *   - Idempotent: every category/product/variant is upserted by its unique
 *     (business_id, slug) / (business_id, sku) key, so re-running this is
 *     always safe and never duplicates rows.
 *   - Never touches orders, customers, inventory reservations, or any
 *     existing row it did not itself create.
 *   - Never resets or truncates anything.
 *
 * Usage (from repo root, picks up .env the way `pnpm db:*` scripts do):
 *   node scripts/with-env.mjs node packages/db/scripts/seed-demo-catalogue.mjs
 */
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const prisma = new PrismaClient();

const CATEGORIES = [
  {
    slug: 'grains-millets',
    name: 'Grains & Millets',
    description: 'Whole grains, millets and pulses.',
  },
  {
    slug: 'ready-to-eat',
    name: 'Ready to Eat',
    description: 'Cooked meals, ready for your delivery slot.',
  },
];

const PRODUCTS = [
  {
    categorySlug: 'grains-millets',
    slug: 'moong-dal-khichdi-mix',
    name: 'Moong Dal Khichdi Mix',
    shortDescription: 'A wholesome one-pot mix of moong dal, rice and light spices.',
    dietaryTags: ['vegetarian', 'gluten-free'],
    variants: [
      {
        sku: 'DEMO-KHI-500',
        name: '500g pack',
        unit: 'g',
        unitValue: 500,
        pricePaise: 14900,
        mrpPaise: 16900,
        stock: 40,
      },
      {
        sku: 'DEMO-KHI-1000',
        name: '1kg pack',
        unit: 'g',
        unitValue: 1000,
        pricePaise: 27900,
        mrpPaise: 31900,
        stock: 20,
      },
    ],
  },
  {
    categorySlug: 'ready-to-eat',
    slug: 'millet-veg-pulao',
    name: 'Millet Vegetable Pulao',
    shortDescription: 'Foxtail millet pulao with seasonal vegetables, ready to heat and eat.',
    dietaryTags: ['vegetarian'],
    variants: [
      {
        sku: 'DEMO-PUL-350',
        name: 'Single serve (350g)',
        unit: 'g',
        unitValue: 350,
        pricePaise: 11900,
        stock: 25,
      },
    ],
  },
];

async function main() {
  const appEnv = process.env.APP_ENV ?? 'local';
  if (appEnv === 'production') {
    throw new Error(
      'Refusing to seed demo catalogue data into APP_ENV=production. This script ' +
        'is for staging/demo environments only — a real business catalogue is ' +
        'created through the admin panel, not synthetic data.',
    );
  }

  const business = await prisma.business.findFirst({ select: { id: true } });
  if (!business) {
    throw new Error('No business row found — run the main seed (pnpm db:seed) first.');
  }
  const businessId = business.id;

  const categoryIdBySlug = new Map();

  for (const [index, category] of CATEGORIES.entries()) {
    // The (business_id, slug) uniqueness is a partial index created in raw
    // migration SQL, not a named Prisma `@@unique` — find-then-create is the
    // straightforward, equally-safe idempotent approach for a one-shot seed.
    let row = await prisma.category.findFirst({
      where: { businessId, slug: category.slug, deletedAt: null },
    });
    if (!row) {
      row = await prisma.category.create({
        data: {
          id: uuidv7(),
          businessId,
          name: category.name,
          slug: category.slug,
          description: category.description,
          displayOrder: index,
          isActive: true,
        },
      });
    }

    categoryIdBySlug.set(category.slug, row.id);
    console.warn(`category: ${category.slug} -> ${row.id}`);
  }

  for (const product of PRODUCTS) {
    const categoryId = categoryIdBySlug.get(product.categorySlug);

    let productRow = await prisma.product.findFirst({
      where: { businessId, slug: product.slug, deletedAt: null },
    });
    if (!productRow) {
      productRow = await prisma.product.create({
        data: {
          id: uuidv7(),
          businessId,
          categoryId,
          name: product.name,
          slug: product.slug,
          shortDescription: product.shortDescription,
          dietaryTags: product.dietaryTags,
          status: 'DRAFT',
        },
      });
      console.warn(
        `product: ${product.slug} -> ${productRow.id} (DRAFT — publish it from the admin panel)`,
      );
    } else {
      console.warn(`product: ${product.slug} already exists -> ${productRow.id} (skipped)`);
    }

    for (const [index, variant] of product.variants.entries()) {
      const existingVariant = await prisma.productVariant.findFirst({
        where: { businessId, sku: variant.sku },
      });
      if (existingVariant) {
        console.warn(`  variant: ${variant.sku} already exists (skipped)`);
        continue;
      }

      const createdVariant = await prisma.productVariant.create({
        data: {
          id: uuidv7(),
          businessId,
          productId: productRow.id,
          sku: variant.sku,
          name: variant.name,
          unit: variant.unit,
          unitValue: variant.unitValue,
          pricePaise: BigInt(variant.pricePaise),
          mrpPaise: variant.mrpPaise ? BigInt(variant.mrpPaise) : null,
          isDefault: index === 0,
        },
      });

      await prisma.inventory.create({
        data: {
          id: uuidv7(),
          businessId,
          variantId: createdVariant.id,
          locationCode: 'MAIN',
          quantityOnHand: variant.stock,
        },
      });

      console.warn(`  variant: ${variant.sku} -> ${createdVariant.id} (stock ${variant.stock})`);
    }
  }

  console.warn(
    '\nDone. Every product above was created DRAFT — publish it from /products in the admin panel to make it visible in the public catalogue.',
  );
}

main()
  .catch((error) => {
    console.error('seed-demo-catalogue failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
