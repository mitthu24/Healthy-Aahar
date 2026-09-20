import { z } from 'zod';
import { appEnvSchema } from './app-env.js';

/**
 * Client-side environment contract.
 *
 * Everything here ships to the browser and is PUBLIC by definition. A value
 * that must stay secret must never carry the NEXT_PUBLIC_ prefix (BR-ENV5).
 * CI asserts this independently — see scripts/check-public-env.mjs.
 *
 * Firebase web config is intentionally public: it identifies a project, it
 * does not authorise anything. Security comes from Firebase rules, App Check
 * and our own API (docs/07-AUTHENTICATION-AUTHORIZATION.md §2).
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

/** apps/customer — CUSTOMER Firebase project only. */
export const customerFirebaseEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: z.string().optional(),
  NEXT_PUBLIC_USE_AUTH_EMULATOR: z.enum(['true', 'false']).optional(),
});

/** apps/admin — ADMIN Firebase project only. Separate keys, separate project. */
export const adminFirebaseEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_ADMIN_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_ADMIN_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_ADMIN_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_ADMIN_APP_ID: z.string().min(1),
  NEXT_PUBLIC_USE_AUTH_EMULATOR: z.enum(['true', 'false']).optional(),
});

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
