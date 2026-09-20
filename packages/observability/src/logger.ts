import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/**
 * Structured JSON logging (docs/28-OBSERVABILITY.md §2).
 *
 * The redaction list below is an ALLOW-LIST of shapes we refuse to emit. A
 * deny-list would eventually miss a newly added field and the failure would be
 * silent — PII in a log drain that nobody notices until an audit (BR-SEC15).
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.token',
  '*.idToken',
  '*.accessToken',
  '*.refreshToken',
  '*.sessionCookie',
  '*.phone',
  '*.email',
  '*.recipientPhone',
  '*.recipientName',
  '*.line1',
  '*.line2',
  '*.landmark',
  '*.addressSnapshot',
  '*.cardNumber',
  '*.cvv',
  'DATABASE_URL',
  '*.DATABASE_URL',
];

export type CreateLoggerOptions = {
  service: string;
  env: string;
  version: string;
  level?: string;
  pretty?: boolean;
};

export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level ?? 'info',
    base: {
      service: options.service,
      env: options.env,
      version: options.version,
    },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

/** Mask an email for a support-facing log line: pr****@example.com */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '[redacted]';
  return `${local.slice(0, 2)}****@${domain}`;
}

/** Mask an E.164 phone: +9198****3210 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '[redacted]';
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}
