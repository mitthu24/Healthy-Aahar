import { z } from 'zod';
import { appEnvSchema } from './common.js';

/** Liveness. Cheap, no dependencies — answers "is this process alive". */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  env: appEnvSchema,
  uptime_s: z.number(),
  timestamp: z.string().datetime(),
});

/**
 * Readiness. Checks dependencies — answers "should traffic be sent here".
 * Railway gates a deploy on this, so a broken database means the new version
 * never receives traffic rather than failing every request.
 */
export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  env: appEnvSchema,
  timestamp: z.string().datetime(),
  checks: z.object({
    database: z.object({
      status: z.enum(['ok', 'degraded', 'down']),
      latency_ms: z.number(),
      migrations_applied: z.number().int().optional(),
      reason: z.string().optional(),
    }),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
