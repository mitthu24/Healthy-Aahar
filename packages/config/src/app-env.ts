import { z } from 'zod';

/**
 * APP_ENV is the only thing application behaviour may branch on.
 *
 * NODE_ENV is NOT a substitute: a Vercel preview deployment runs with
 * NODE_ENV=production but must never send a real email to a real customer.
 * Conflating the two is the most common cause of a staging system contacting
 * production users. See docs/27-ENVIRONMENT-CONFIGURATION.md §1, BR-ENV2, BR-ENV3.
 */
export const appEnvSchema = z.enum(['local', 'preview', 'staging', 'production']);

export type AppEnv = z.infer<typeof appEnvSchema>;

export function isProduction(appEnv: AppEnv): boolean {
  return appEnv === 'production';
}

/**
 * Real outbound messages (email / SMS / WhatsApp) are permitted in exactly one
 * environment. Everything else resolves to the Noop channel (BR-N9, BR-ENV3).
 */
export function allowsExternalSends(appEnv: AppEnv): boolean {
  return appEnv === 'production';
}
