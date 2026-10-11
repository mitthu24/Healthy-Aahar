#!/usr/bin/env node
/**
 * Safe default delivery-slot bootstrap (Phase 04).
 *
 * WHY THIS EXISTS
 *
 * Healthy Aahar's checkout is delivery-SLOT-only (no delivery-zone
 * management in this phase — see migration
 * 20261011080000_phase04_delivery_slot_only and
 * docs/PHASE-04-STOREFRONT-IMPLEMENTATION-REPORT.md). A fresh environment
 * has zero `DeliverySlot` rows, so there is nothing for a customer to pick
 * at checkout until a founder/admin creates one (via the admin delivery-slot
 * API) or this script seeds the default two windows:
 *
 *   - Morning: 07:00-08:00
 *   - Evening: 18:00-19:00
 *
 * These are a starting point, not a permanent limit — the founder/admin can
 * create, edit, activate or deactivate further slots at any time through
 * `/v1/admin/delivery-slots`.
 *
 * This script creates NO `DeliveryZone`, `SlotZoneAssignment` or
 * `ServicePincode` rows — that concept is out of scope for this phase.
 *
 * Safety, same pattern as seed-demo-catalogue.mjs:
 *   - REFUSES under APP_ENV=production, no override. Slot capacity, cutoff
 *     times and delivery fees are real operational decisions this script
 *     has no business inventing for a live business.
 *   - Idempotent: skips any slot code that already exists. A founder/admin
 *     may have since edited that slot's times, capacity or active state —
 *     this script never touches an existing row, only inserts missing ones.
 *   - Never resets, truncates, deletes or updates anything.
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

const DEFAULT_SLOTS = [
  {
    code: 'morning',
    name: 'Morning (07:00 - 08:00)',
    startTime: '07:00',
    endTime: '08:00',
    displayOrder: 0,
  },
  {
    code: 'evening',
    name: 'Evening (18:00 - 19:00)',
    startTime: '18:00',
    endTime: '19:00',
    displayOrder: 1,
  },
];

async function main() {
  const appEnv = process.env.APP_ENV ?? 'local';
  if (appEnv === 'production') {
    throw new Error(
      'Refusing to seed default delivery slots into APP_ENV=production. ' +
        'Slot capacity, cutoffs and fees are real operational decisions — ' +
        'configure them deliberately through the admin delivery-slot API, not with synthetic defaults.',
    );
  }

  const business = await prisma.business.findFirst({ select: { id: true } });
  if (!business) {
    throw new Error('No business row found — run the main seed (pnpm db:seed) first.');
  }
  const businessId = business.id;

  for (const def of DEFAULT_SLOTS) {
    const existing = await prisma.deliverySlot.findFirst({
      where: { businessId, code: def.code },
    });
    if (existing) {
      console.warn(`slot: ${def.code} already exists -> ${existing.id} (skipped, left untouched)`);
      continue;
    }

    const slot = await prisma.deliverySlot.create({
      data: {
        id: uuidv7(),
        businessId,
        name: def.name,
        code: def.code,
        startTime: timeOnly(def.startTime),
        endTime: timeOnly(def.endTime),
        cutoffTime: timeOnly(def.startTime),
        cutoffDaysBefore: 0,
        availableDays: [1, 2, 3, 4, 5, 6, 7],
        defaultCapacity: 20,
        isActive: true,
        displayOrder: def.displayOrder,
      },
    });
    console.warn(`slot: ${def.code} -> ${slot.id}`);
  }

  console.warn(
    '\nDone. Customers can now select a delivery slot at checkout. ' +
      'Manage slots (times, capacity, active state, new windows) at /v1/admin/delivery-slots.',
  );
}

main()
  .catch((error) => {
    console.error('seed-demo-delivery failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
