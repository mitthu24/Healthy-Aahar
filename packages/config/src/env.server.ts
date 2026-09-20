import { z } from 'zod';
import { appEnvSchema } from './app-env.js';

/**
 * Server-side environment contract.
 *
 * Validated once at process start. A missing or malformed variable crashes the
 * service at boot with a readable message naming the variable, rather than at
 * 2am on the first request that happens to need it (BR-ENV1).
 */

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65535);

export const serverEnvSchema = z
  .object({
    // ── Application ──────────────────────────────────────────────────────
    APP_ENV: appEnvSchema,
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: port.default(4000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    APP_VERSION: z.string().default('dev'),

    // ── Database ─────────────────────────────────────────────────────────
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),

    // ── CORS: explicit allow-list, never a wildcard (docs/23 §7) ─────────
    ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    // ── Firebase: CUSTOMER project ───────────────────────────────────────
    FIREBASE_CUSTOMER_PROJECT_ID: z.string().min(1),
    FIREBASE_CUSTOMER_SERVICE_ACCOUNT_B64: z.string().optional(),

    // ── Firebase: ADMIN project (deliberately separate, ADR-010) ─────────
    FIREBASE_ADMIN_PROJECT_ID: z.string().min(1),
    FIREBASE_ADMIN_SERVICE_ACCOUNT_B64: z.string().optional(),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),

    // ── Sessions ─────────────────────────────────────────────────────────
    ADMIN_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().default(43200),
    ADMIN_SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().default(1800),

    // ── Email ────────────────────────────────────────────────────────────
    BREVO_API_KEY: z.string().optional(),
    BREVO_SENDER_EMAIL: z.string().email().optional(),
    BREVO_SENDER_NAME: z.string().default('Healthy Aahar'),
    BREVO_WEBHOOK_SECRET: z.string().optional(),
    NOTIFICATIONS_ENABLED: booleanish.default('false'),

    // ── Object storage ───────────────────────────────────────────────────
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().default('healthy-aahar-media-local'),
    R2_PUBLIC_BASE_URL: z.string().url().optional(),
    R2_ENDPOINT: z.string().url().optional(),
    R2_UPLOAD_MAX_BYTES: z.coerce.number().int().default(5242880),
    R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().default(300),

    // ── Worker to API internal auth ──────────────────────────────────────
    INTERNAL_SERVICE_TOKEN: z.string().min(16),

    // ── Business defaults ────────────────────────────────────────────────
    // These SEED the settings table on first run; afterwards the database is
    // authoritative (docs/27 §6). They are defaults, not business logic:
    // no code may branch on them.
    DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
    DEFAULT_CURRENCY: z.string().length(3).default('INR'),
    BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    SUBSCRIPTION_GENERATION_HORIZON_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    SUBSCRIPTION_MATERIALISE_HORIZON_HOURS: z.coerce.number().int().min(1).default(36),

    // ── Rate limiting ────────────────────────────────────────────────────
    RATE_LIMIT_ENABLED: booleanish.default('true'),
    RATE_LIMIT_READ_PER_MIN: z.coerce.number().int().default(300),
    RATE_LIMIT_WRITE_PER_MIN: z.coerce.number().int().default(60),
    RATE_LIMIT_ORDER_PER_MIN: z.coerce.number().int().default(10),

    // ── Observability ────────────────────────────────────────────────────
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    // ── Worker ───────────────────────────────────────────────────────────
    WORKER_ENABLED: booleanish.default('true'),
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().default(15000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().default(5),

    // ── Feature flags: off by default, each switched on by its own phase ──
    FEATURE_COUPONS: booleanish.default('false'),
    FEATURE_REVIEWS: booleanish.default('false'),
    FEATURE_ONLINE_PAYMENT: booleanish.default('false'),
    FEATURE_WHATSAPP: booleanish.default('false'),
  })
  .superRefine((env, ctx) => {
    const requireInProd = (key: string, value: unknown, reason: string) => {
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when APP_ENV=production (${reason})`,
        });
      }
    };

    if (env.APP_ENV === 'production') {
      requireInProd(
        'FIREBASE_CUSTOMER_SERVICE_ACCOUNT_B64',
        env.FIREBASE_CUSTOMER_SERVICE_ACCOUNT_B64,
        'token verification',
      );
      requireInProd(
        'FIREBASE_ADMIN_SERVICE_ACCOUNT_B64',
        env.FIREBASE_ADMIN_SERVICE_ACCOUNT_B64,
        'token verification',
      );
      requireInProd('SENTRY_DSN', env.SENTRY_DSN, 'error tracking');
      requireInProd('R2_PUBLIC_BASE_URL', env.R2_PUBLIC_BASE_URL, 'media delivery');

      if (env.NOTIFICATIONS_ENABLED && !env.BREVO_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BREVO_API_KEY'],
          message: 'BREVO_API_KEY is required when NOTIFICATIONS_ENABLED=true',
        });
      }

      if (env.ALLOWED_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ALLOWED_ORIGINS'],
          message: 'ALLOWED_ORIGINS must be set explicitly in production (docs/23 §7)',
        });
      }

      if (env.ALLOWED_ORIGINS.some((o) => o.includes('*') || o.includes('vercel.app'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ALLOWED_ORIGINS'],
          message: 'Production CORS must not allow wildcards or preview origins (docs/23 §7)',
        });
      }

      if (env.FIREBASE_AUTH_EMULATOR_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FIREBASE_AUTH_EMULATOR_HOST'],
          message: 'The Firebase auth emulator must never be configured in production',
        });
      }
    }

    // Two Firebase projects must genuinely be two projects (ADR-010). If they
    // are equal, the token-audience separation that makes privilege escalation
    // impossible simply does not exist, and nothing else in the system would
    // notice.
    if (env.FIREBASE_CUSTOMER_PROJECT_ID === env.FIREBASE_ADMIN_PROJECT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_ADMIN_PROJECT_ID'],
        message:
          'Customer and admin Firebase projects must differ. A shared project removes the token-audience separation that prevents privilege escalation (ADR-010).',
      });
    }

    // Non-production must be structurally incapable of contacting a real
    // customer (BR-N9). This is enforced here rather than trusted to config.
    if (env.APP_ENV !== 'production' && env.NOTIFICATIONS_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATIONS_ENABLED'],
        message:
          'NOTIFICATIONS_ENABLED must be false outside production. Non-production never contacts real customers (BR-N9).',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Parse and cache the server environment. Throws a single readable error that
 * aggregates every invalid variable, so a misconfigured deploy fails fast and
 * completely rather than one variable at a time.
 */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(
      [
        'Invalid environment configuration:',
        ...lines,
        '',
        'See .env.example and docs/27-ENVIRONMENT-CONFIGURATION.md',
      ].join('\n'),
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test helper only. Never call this from application code. */
export function resetServerEnvCache(): void {
  cached = null;
}
