import type { JobDefinition } from '../lib/job-runner.js';

/**
 * Job catalogue.
 *
 * PHASE 01 registers the schedule and the runner, not the business logic.
 * Each job below is a real, recorded, locked execution that currently does
 * nothing, so the dead-man's-switch monitoring and the `job_runs` plumbing are
 * exercised from day one rather than first switched on in PHASE 09 — when a
 * silent scheduler failure would mean customers not receiving food.
 *
 * Implementations arrive with their phases (docs/34-PHASED-ROADMAP.md).
 */
export const jobs: JobDefinition[] = [
  {
    name: 'heartbeat',
    schedule: '*/5 * * * *',
    phase: '01',
    description: 'Proves the scheduler, advisory lock and job_runs recording all work.',
    run: async ({ logger }) => {
      logger.debug({ msg: 'heartbeat.tick' }, 'worker alive');
      return { itemsProcessed: 0, metadata: { note: 'phase-01 heartbeat' } };
    },
  },
  {
    name: 'roll-slot-capacity',
    schedule: '30 0 * * *',
    phase: '06',
    description: 'Ensures slot_capacity rows exist across the booking horizon.',
    run: async () => ({ itemsProcessed: 0, metadata: { pending_phase: '06' } }),
  },
  {
    name: 'generate-subscription-deliveries',
    schedule: '0 1 * * *',
    phase: '09',
    description: 'Extends subscription_deliveries to the generation horizon.',
    run: async () => ({ itemsProcessed: 0, metadata: { pending_phase: '09' } }),
  },
  {
    name: 'materialise-subscription-orders',
    schedule: '0 * * * *',
    phase: '09',
    description: 'Turns imminent scheduled deliveries into real orders.',
    run: async () => ({ itemsProcessed: 0, metadata: { pending_phase: '09' } }),
  },
  {
    name: 'dispatch-outbox',
    schedule: '* * * * *',
    phase: '11',
    description: 'Delivers pending domain events to notification channels.',
    run: async () => ({ itemsProcessed: 0, metadata: { pending_phase: '11' } }),
  },
];
