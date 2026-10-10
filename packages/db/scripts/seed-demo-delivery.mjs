#!/usr/bin/env node
/**
 * STAGING-ONLY delivery zone/slot bootstrap (Phase 04C).
 *
 * WHY THIS EXISTS
 *
 * Checkout (`POST /v1/me/orders`) requires an address to resolve to a
 * `DeliveryZone` (via `ServicePincode.delivery_zone_id`) and a
 * `DeliverySlot` assigned to that zone (`SlotZoneAssignment`). PHASE 06
 * ("Delivery Zones & Slots", docs/34) is where an admin gets a real screen
 * to manage these — it has not been built yet. Without it, there is
 * currently NO way, in any environment, for the customer checkout journey
 * to reach a CONFIRMED order: every ACTIVE city/pincode the main seed
 * creates (`prisma/seed.ts`) leaves `delivery_zone_id` null on purpose
 * (PHASE 06 may narrow serviceability, never widen it — docs/06).
 *
 * This script is the narrowest possible unblock: one zone per ACTIVE city
 * that has no zone yet, one slot, one assignment between them. It is NOT a
 * replacement for the PHASE 06 admin UI — it exists only so a staging/demo
 * environment can exercise the full acceptance journey
 * (publish -> browse -> cart -> address -> COD checkout -> CONFIRMED)
 * today.
 *
 * Safety, same pattern as seed-demo-catalogue.mjs:
 *   - REFUSES under APP_ENV=production, no override. A real zone/slot
 *     configuration is an operational decision (capacity, cutoff times,
 *     delivery fees) this script has no business inventing for a live
 *     business.
 *   - Idempotent: skips any pincode that already has a delivery_zone_id,
 *     and any zone/slot/assignment that already exists by name/code.
 *   - Never resets, truncates or deletes anything.
 *
 * Usage (from repo root):
 *   node scripts/with-env.mjs node packages/db/scripts/seed-demo-delivery.mjs
 */
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const prisma = new PrismaClient();

function timeOnly(hhmm) {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

async function main() {
  const appEnv = process.env.APP_ENV ?? 'local';
  if (appEnv === 'production') {
    throw new Error(
      'Refusing to bootstrap demo delivery zones/slots into APP_ENV=production. ' +
        'Zone capacity, cutoffs and fees are real operational decisions — ' +
        'configure them deliberately, not with synthetic defaults.',
    );
  }

  const business = await prisma.business.findFirst({ select: { id: true } });
  if (!business) {
    throw new Error('No business row found — run the main seed (pnpm db:seed) first.');
  }
  const businessId = business.id;

  const activeCities = await prisma.city.findMany({ where: { businessId, status: 'ACTIVE' } });
  if (activeCities.length === 0) {
    throw new Error('No ACTIVE city found — run the main seed (pnpm db:seed) first.');
  }

  // One slot, shared by every zone this script creates. Wide-open on
  // purpose (every day, generous capacity, no cutoff) — a demo convenience,
  // not a template for a real slot.
  const slotCode = 'demo-anytime';
  let slot = await prisma.deliverySlot.findFirst({ where: { businessId, code: slotCode } });
  if (!slot) {
    slot = await prisma.deliverySlot.create({
      data: {
        id: uuidv7(),
        businessId,
        name: 'Anytime (demo)',
        code: slotCode,
        startTime: timeOnly('09:00'),
        endTime: timeOnly('20:00'),
        cutoffTime: timeOnly('23:59'),
        cutoffDaysBefore: 0,
        availableDays: [1, 2, 3, 4, 5, 6, 7],
        defaultCapacity: 500,
        isActive: true,
      },
    });
    console.warn(`slot: ${slotCode} -> ${slot.id}`);
  } else {
    console.warn(`slot: ${slotCode} already exists -> ${slot.id} (skipped)`);
  }

  for (const city of activeCities) {
    const zoneCode = `demo-${city.slug}`;
    let zone = await prisma.deliveryZone.findFirst({ where: { businessId, code: zoneCode } });
    if (!zone) {
      zone = await prisma.deliveryZone.create({
        data: {
          id: uuidv7(),
          businessId,
          cityId: city.id,
          name: `${city.name} (demo zone)`,
          code: zoneCode,
          deliveryFeePaise: 2900,
          freeDeliveryAbovePaise: 50000,
          minOrderValuePaise: 0,
          isActive: true,
        },
      });
      console.warn(`zone: ${zoneCode} -> ${zone.id} (city ${city.name})`);
    } else {
      console.warn(`zone: ${zoneCode} already exists -> ${zone.id} (skipped)`);
    }

    const existingAssignment = await prisma.slotZoneAssignment.findFirst({
      where: { deliverySlotId: slot.id, deliveryZoneId: zone.id },
    });
    if (!existingAssignment) {
      await prisma.slotZoneAssignment.create({
        data: { id: uuidv7(), deliverySlotId: slot.id, deliveryZoneId: zone.id, isActive: true },
      });
      console.warn(`  assigned slot ${slotCode} -> zone ${zoneCode}`);
    }

    const unzonedPincodes = await prisma.servicePincode.findMany({
      where: { businessId, cityId: city.id, status: 'ACTIVE', deliveryZoneId: null },
    });
    for (const pincode of unzonedPincodes) {
      await prisma.servicePincode.update({
        where: { id: pincode.id },
        data: { deliveryZoneId: zone.id },
      });
      console.warn(`  pincode ${pincode.pincode} -> zone ${zoneCode}`);
    }
    if (unzonedPincodes.length === 0) {
      console.warn(`  no unzoned ACTIVE pincodes in ${city.name} (already zoned, or skipped)`);
    }
  }

  console.warn(
    '\nDone. Any address a customer saves with one of these pincodes will now resolve to ' +
      'a delivery zone and be able to complete checkout.',
  );
}

main()
  .catch((error) => {
    console.error('seed-demo-delivery failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
