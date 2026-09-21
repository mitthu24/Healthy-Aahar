#!/usr/bin/env node
/**
 * Assert that the hand-written database layer is actually present.
 *
 * WHY THIS EXISTS
 *
 * Prisma cannot model CHECK constraints, partial unique indexes, generated
 * columns, GIN indexes or triggers. `prisma migrate diff` therefore cannot
 * see them — and worse, it will happily DROP anything it can model but finds
 * missing from the schema.
 *
 * That is not hypothetical. The Phase 02 migration silently dropped the
 * composite foreign key that keeps a pincode inside its own business,
 * because Phase 01 had created it in raw SQL alone (ADR-032).
 *
 * A `migrate diff --exit-code` check cannot guard this: it reports the
 * un-modellable objects as permanent false-positive drift. So instead of
 * asking "does the database match the model", this asks the question that
 * actually matters: "are the invariants still there".
 *
 * Run after migrations, in CI and before any release.
 */
import { PrismaClient } from '@prisma/client';

/** Objects whose absence would silently remove a documented guarantee. */
const REQUIRED = {
  checkConstraints: [
    // Serviceability (docs/04 §6)
    ['service_pincodes', 'service_pincodes_format'],
    ['service_pincodes', 'service_pincodes_active_requires_activated_at'],
    ['cities', 'cities_active_requires_activated_at'],
    ['cities', 'cities_country_iso3166'],
    // Invariant 1 — no slot over-booking (BR-D6)
    ['slot_capacity', 'slot_capacity_booked_within_capacity'],
    // Invariant 2 — no negative or oversold stock (BR-I6)
    ['inventory', 'inventory_on_hand_non_negative'],
    ['inventory', 'inventory_reserved_within_stock'],
    // Invariant 5 — the invoice always adds up
    ['orders', 'orders_total_is_sum_of_parts'],
    ['orders', 'orders_source_matches_subscription'],
    // Money can never be negative or inverted
    ['product_variants', 'product_variants_mrp_gte_price'],
    ['product_variants', 'product_variants_sub_price_lte_price'],
    ['payments', 'payments_refunded_within_paid'],
    // Combo lines: money vs logistics (docs/12 §2)
    ['order_items', 'order_items_component_has_parent'],
    ['order_items', 'order_items_exactly_one_target'],
  ],

  uniqueIndexes: [
    // Invariant 3 — one delivery per subscription per date (BR-S9)
    'subscription_deliveries_subscription_id_delivery_date_key',
    // Invariant 4 — one order per subscription delivery (BR-S9)
    'orders_one_per_subscription_delivery',
    // Serviceability determinism (BR-SV2)
    'service_pincodes_business_id_pincode_key',
    // Exactly one default per parent
    'addresses_one_default_per_customer',
    'product_variants_one_default_per_product',
    'product_images_one_primary_per_product',
  ],

  /** Foreign keys that carry a tenant-isolation guarantee (BR-SV3). */
  compositeForeignKeys: [
    ['service_pincodes', 'service_pincodes_city_id_business_id_fkey'],
    ['product_variants', 'product_variants_product_id_business_id_fkey'],
  ],

  /** Append-only enforcement (BR-SEC14). */
  triggers: [
    ['audit_logs', 'audit_logs_no_update'],
    ['audit_logs', 'audit_logs_no_delete'],
    ['order_status_history', 'order_status_history_no_update'],
    ['inventory_movements', 'inventory_movements_no_update'],
  ],

  generatedColumns: [['products', 'search_vector']],

  ginIndexes: ['products_search_vector_idx', 'products_dietary_tags_idx', 'products_name_trgm_idx'],
};

const prisma = new PrismaClient();
const problems = [];

async function main() {
  const checks = await prisma.$queryRaw`
    SELECT conrelid::regclass::text AS table_name, conname
    FROM pg_constraint WHERE contype = 'c'`;
  const checkSet = new Set(checks.map((r) => `${r.table_name}.${r.conname}`));

  for (const [table, name] of REQUIRED.checkConstraints) {
    if (!checkSet.has(`${table}.${name}`)) {
      problems.push(`missing CHECK constraint ${table}.${name}`);
    }
  }

  const indexes = await prisma.$queryRaw`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
  const indexSet = new Set(indexes.map((r) => r.indexname));

  for (const name of [...REQUIRED.uniqueIndexes, ...REQUIRED.ginIndexes]) {
    if (!indexSet.has(name)) problems.push(`missing index ${name}`);
  }

  const fks = await prisma.$queryRaw`
    SELECT conrelid::regclass::text AS table_name, conname,
           array_length(conkey, 1) AS col_count
    FROM pg_constraint WHERE contype = 'f'`;
  const fkMap = new Map(fks.map((r) => [`${r.table_name}.${r.conname}`, Number(r.col_count)]));

  for (const [table, name] of REQUIRED.compositeForeignKeys) {
    const cols = fkMap.get(`${table}.${name}`);
    if (cols === undefined) {
      problems.push(`missing composite FK ${table}.${name} — tenant isolation is NOT enforced`);
    } else if (cols < 2) {
      problems.push(`${table}.${name} exists but spans ${cols} column(s); expected 2`);
    }
  }

  const triggers = await prisma.$queryRaw`
    SELECT event_object_table AS table_name, trigger_name
    FROM information_schema.triggers WHERE trigger_schema = 'public'`;
  const triggerSet = new Set(triggers.map((r) => `${r.table_name}.${r.trigger_name}`));

  for (const [table, name] of REQUIRED.triggers) {
    if (!triggerSet.has(`${table}.${name}`)) {
      problems.push(`missing append-only trigger ${table}.${name}`);
    }
  }

  const generated = await prisma.$queryRaw`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_generated = 'ALWAYS'`;
  const genSet = new Set(generated.map((r) => `${r.table_name}.${r.column_name}`));

  for (const [table, column] of REQUIRED.generatedColumns) {
    if (!genSet.has(`${table}.${column}`)) {
      problems.push(`${table}.${column} is not a GENERATED column — it can drift from its row`);
    }
  }

  const total =
    REQUIRED.checkConstraints.length +
    REQUIRED.uniqueIndexes.length +
    REQUIRED.ginIndexes.length +
    REQUIRED.compositeForeignKeys.length +
    REQUIRED.triggers.length +
    REQUIRED.generatedColumns.length;

  if (problems.length > 0) {
    console.error('\nDatabase invariant check FAILED:\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nA migration has removed a guarantee the application relies on.\n' +
        'See docs/31-BUSINESS-RULES.md and ADR-032.\n',
    );
    process.exit(1);
  }

  // eslint-disable-next-line no-console -- a CLI check reports success on stdout
  console.log(`Database invariant check passed: ${total} required objects present.`);
}

main()
  .catch((error) => {
    console.error('Database invariant check could not run:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
