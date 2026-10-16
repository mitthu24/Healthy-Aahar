/**
 * Database seed — PHASE 01.
 *
 * Loads bootstrap DATA from `seed-data/bootstrap.json`. The script contains no
 * business knowledge: it does not know that the launch city is Noida, nor that
 * a morning slot starts at 07:00. Those live in the JSON, and after the first
 * deploy they live in the database under admin control (BR-SV1).
 *
 * Idempotent: safe to re-run. Existing rows are updated, never duplicated, and
 * an admin's later changes to `status` are NOT overwritten — see §"status" below.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNIT_CATALOG } from '@healthy-aahar/contracts';
import { SYSTEM_ROLES } from '@healthy-aahar/core';
import { PrismaClient, ServiceabilityStatus } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

/** Stage F: symbols for the pre-Stage-F hardcoded unit codes, used only to
 *  back-fill their initial `units` rows — not a general code-to-symbol
 *  mapping (new units created via the admin UI supply their own symbol). */
const UNIT_SYMBOLS: Record<string, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  L: 'L',
  piece: 'pc',
  pack: 'pack',
};

const here = dirname(fileURLToPath(import.meta.url));

type PincodeSeed = {
  pincode: string;
  areaName?: string;
  status: keyof typeof ServiceabilityStatus;
  displayOrder?: number;
};

type CitySeed = {
  name: string;
  slug: string;
  displayName?: string;
  state: string;
  country?: string;
  timezone?: string;
  status: keyof typeof ServiceabilityStatus;
  displayOrder?: number;
  pincodes: PincodeSeed[];
};

type SettingSeed = {
  key: string;
  value: unknown;
  description?: string;
  isPublic?: boolean;
};

type Bootstrap = {
  business: {
    name: string;
    slug: string;
    timezone?: string;
    currency?: string;
    supportEmail?: string;
    supportPhone?: string;
  };
  cities: CitySeed[];
  settings: SettingSeed[];
};

function loadBootstrap(): Bootstrap {
  const path = resolve(here, 'seed-data', 'bootstrap.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Bootstrap;
}

function log(message: string): void {
  // stderr so seed output never contaminates piped stdout.
  console.error(`[seed] ${message}`);
}

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? 'local';
  const force = process.argv.includes('--force');

  // Seeding production would overwrite real admin configuration with
  // development values. It requires an explicit, deliberate flag.
  if (appEnv === 'production' && !force) {
    throw new Error(
      'Refusing to seed APP_ENV=production. Production configuration is owned by the ' +
        'admin panel. Re-run with --force only if you are bootstrapping an empty ' +
        'production database.',
    );
  }

  const data = loadBootstrap();
  const prisma = new PrismaClient();

  // A seed is a one-shot script, not application logic: there is no Clock to
  // inject and no cutoff arithmetic to make testable. One timestamp is read
  // here and reused, so every row seeded in a run shares an activation time.
  // eslint-disable-next-line no-restricted-syntax
  const seededAt = new Date();

  try {
    log(`environment=${appEnv}`);

    // ── Business ─────────────────────────────────────────────────────────
    const business = await prisma.business.upsert({
      where: { slug: data.business.slug },
      create: {
        id: uuidv7(),
        name: data.business.name,
        slug: data.business.slug,
        timezone: data.business.timezone ?? 'Asia/Kolkata',
        currency: data.business.currency ?? 'INR',
        supportEmail: data.business.supportEmail ?? null,
        supportPhone: data.business.supportPhone ?? null,
      },
      update: {
        name: data.business.name,
        timezone: data.business.timezone ?? 'Asia/Kolkata',
        currency: data.business.currency ?? 'INR',
      },
    });
    log(`business: ${business.name} (${business.id})`);

    // ── Cities and pincodes ──────────────────────────────────────────────
    //
    // "status" is written on CREATE only. On update we leave it alone: if an
    // admin has switched a pincode off in staging, re-running the seed must
    // not silently switch it back on. Serviceability is the admin's decision
    // from the moment the row exists (BR-SV1).
    let cityCount = 0;
    let pincodeCount = 0;

    for (const citySeed of data.cities) {
      const status = ServiceabilityStatus[citySeed.status];
      const existingCity = await prisma.city.findUnique({
        where: { businessId_slug: { businessId: business.id, slug: citySeed.slug } },
      });

      const city = existingCity
        ? await prisma.city.update({
            where: { id: existingCity.id },
            data: {
              name: citySeed.name,
              displayName: citySeed.displayName ?? null,
              state: citySeed.state,
              country: citySeed.country ?? 'IN',
              timezone: citySeed.timezone ?? 'Asia/Kolkata',
              displayOrder: citySeed.displayOrder ?? 0,
            },
          })
        : await prisma.city.create({
            data: {
              id: uuidv7(),
              businessId: business.id,
              name: citySeed.name,
              slug: citySeed.slug,
              displayName: citySeed.displayName ?? null,
              state: citySeed.state,
              country: citySeed.country ?? 'IN',
              timezone: citySeed.timezone ?? 'Asia/Kolkata',
              status,
              displayOrder: citySeed.displayOrder ?? 0,
              // The CHECK constraint requires activated_at on an ACTIVE city.
              activatedAt: status === ServiceabilityStatus.ACTIVE ? seededAt : null,
            },
          });

      cityCount += 1;
      log(`city: ${city.name} [${existingCity ? city.status : status}]`);

      for (const pin of citySeed.pincodes) {
        const pinStatus = ServiceabilityStatus[pin.status];
        const existingPin = await prisma.servicePincode.findUnique({
          where: { businessId_pincode: { businessId: business.id, pincode: pin.pincode } },
        });

        if (existingPin) {
          await prisma.servicePincode.update({
            where: { id: existingPin.id },
            data: {
              cityId: city.id,
              areaName: pin.areaName ?? null,
              displayOrder: pin.displayOrder ?? 0,
            },
          });
        } else {
          await prisma.servicePincode.create({
            data: {
              id: uuidv7(),
              businessId: business.id,
              cityId: city.id,
              pincode: pin.pincode,
              areaName: pin.areaName ?? null,
              status: pinStatus,
              displayOrder: pin.displayOrder ?? 0,
              activatedAt: pinStatus === ServiceabilityStatus.ACTIVE ? seededAt : null,
            },
          });
        }
        pincodeCount += 1;
      }
    }
    log(`cities=${cityCount} pincodes=${pincodeCount}`);

    // ── Settings ─────────────────────────────────────────────────────────
    // Stage F: the admin settings screen now lets an operator edit these
    // values, so re-running the seed (every deploy — see the API's start
    // command) must never overwrite a value they've already set. Only
    // creates a row that doesn't exist yet; an existing row's `value` is
    // left untouched (its description/is_public metadata, which the admin
    // UI doesn't expose, still refreshes to match engineering's latest
    // wording).
    for (const setting of data.settings) {
      const existing = await prisma.setting.findUnique({
        where: { businessId_key: { businessId: business.id, key: setting.key } },
        select: { id: true },
      });
      if (existing) {
        await prisma.setting.update({
          where: { id: existing.id },
          data: {
            description: setting.description ?? null,
            isPublic: setting.isPublic ?? false,
          },
        });
      } else {
        await prisma.setting.create({
          data: {
            id: uuidv7(),
            businessId: business.id,
            key: setting.key,
            value: setting.value as never,
            description: setting.description ?? null,
            isPublic: setting.isPublic ?? false,
          },
        });
      }
    }
    log(`settings=${data.settings.length}`);

    // ── Units (Stage F) ──────────────────────────────────────────────────
    // Back-fills the previously-hardcoded UNIT_CATALOG as real rows, once,
    // per business — idempotent (skips a code that already exists) and
    // never overwrites an admin's edit to an existing row's label/symbol/
    // active status on a later re-run.
    let unitCount = 0;
    for (const unit of UNIT_CATALOG) {
      const existingUnit = await prisma.unit.findUnique({
        where: { businessId_code: { businessId: business.id, code: unit.code } },
        select: { id: true },
      });
      if (!existingUnit) {
        await prisma.unit.create({
          data: {
            id: uuidv7(),
            businessId: business.id,
            code: unit.code,
            label: unit.label,
            symbol: UNIT_SYMBOLS[unit.code] ?? unit.code,
            dimension: unit.dimension,
          },
        });
      }
      unitCount += 1;
    }
    log(`units=${unitCount}`);

    // ── RBAC: seven system roles (docs/08 §3) ───────────────────────────
    //
    // Permissions are CODE and were seeded by migration
    // (20260921060000_phase03_seed_permissions); roles are DATA, seeded here
    // like everything else business-scoped. `isSystem: true` on create only —
    // BR-SEC9 forbids renaming or deleting a system role's key, but an owner
    // may still adjust a role's permission set from the admin panel later, so
    // we do NOT overwrite `permissions` on re-run (mirrors the city/pincode
    // `status` rule above: the seed provides the starting point, not a
    // standing override).
    const allPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });
    const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    let roleCount = 0;
    for (const roleSeed of SYSTEM_ROLES) {
      const existing = await prisma.role.findUnique({
        where: { businessId_key: { businessId: business.id, key: roleSeed.key } },
      });

      if (existing) {
        roleCount += 1;
        continue;
      }

      const permissionIds = roleSeed.permissions
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => Boolean(id));

      if (permissionIds.length !== roleSeed.permissions.length) {
        const missing = roleSeed.permissions.filter((key) => !permissionIdByKey.has(key));
        throw new Error(
          `Role "${roleSeed.key}" references unknown permission key(s): ${missing.join(', ')}. ` +
            'Has the permissions migration run?',
        );
      }

      await prisma.role.create({
        data: {
          id: uuidv7(),
          businessId: business.id,
          key: roleSeed.key,
          name: roleSeed.name,
          description: roleSeed.description,
          isSystem: true,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
      });
      roleCount += 1;
    }
    log(`roles=${roleCount}`);

    log('done');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});
