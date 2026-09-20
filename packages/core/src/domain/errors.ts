import { ERROR_CODES, type ErrorCode } from '@healthy-aahar/contracts';

/**
 * Domain errors carry a stable API error code, so the transport layer maps
 * them to HTTP without knowing anything about the domain, and the domain
 * never imports HTTP (docs/02-SYSTEM-ARCHITECTURE.md §4).
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Array<{ field?: string; issue: string }>;
  /** Extra context for logs only. Never serialised to a client. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      details?: Array<{ field?: string; issue: string }>;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = ERROR_CODES[code];
    this.details = options?.details;
    this.context = options?.context;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export const notFound = (message = 'Resource not found') => new DomainError('NOT_FOUND', message);

export const forbidden = (message = 'You do not have permission to do that') =>
  new DomainError('FORBIDDEN', message);

export const validationFailed = (
  message: string,
  details?: Array<{ field?: string; issue: string }>,
) => new DomainError('VALIDATION_FAILED', message, { details });
