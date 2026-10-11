import { z } from 'zod';
import { appEnvSchema } from './app-env.js';

/**
 * Client-side environment contract.
 *
 * Everything here ships to the browser and is PUBLIC by definition. A value
 * that must stay secret must never carry the NEXT_PUBLIC_ prefix (BR-ENV5).
 * CI asserts this independently — see scripts/check-public-env.mjs.
 *
 * PHASE 03 (current): authentication is email/password against our own API
 * with DB-backed sessions — no client-side auth SDK config is needed, so
 * there is no Firebase web config here. (A prior, Firebase-based auth design
 * had per-project web config schemas at this spot; removed, not merely
 * unused, because they described credentials for a project this app no
 * longer talks to. Firebase remains a documented FUTURE option — docs/36
 * ADR-037/038 — and would reintroduce an equivalent schema if adopted.)
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: appEnvSchema,
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  NEXT_PUBLIC_MARKETING_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_CDN_BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(['Invalid public environment configuration:', ...lines].join('\n'));
  }
  return parsed.data as z.infer<T>;
}
