import { isDomainError } from '@healthy-aahar/core';
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

import type { AppBindings } from '../types.js';

/**
 * Maps every thrown error to the documented response envelope
 * (docs/06-API-SPECIFICATION.md §1.4).
 *
 * The rule that matters: `message` is always safe to show a customer, and
 * internal detail never leaks into it. An unexpected error returns a generic
 * message plus the request id, and the real cause goes to the logs only
 * (docs/23-SECURITY-ARCHITECTURE.md §11).
 */

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; issue: string }>;
    request_id: string;
  };
};

function body(
  code: string,
  message: string,
  requestId: string,
  details?: Array<{ field?: string; issue: string }>,
): ErrorBody {
  return { error: { code, message, ...(details ? { details } : {}), request_id: requestId } };
}

export const errorHandler: ErrorHandler<AppBindings> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  const logger = c.get('logger');

  // Zod validation failure — safe to surface field-level detail.
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      issue: issue.message,
    }));

    logger?.info({ msg: 'request.validation_failed', details }, 'validation failed');

    return c.json(
      body(
        'VALIDATION_FAILED',
        'Some of the information provided is not valid.',
        requestId,
        details,
      ),
      422,
    );
  }

  // Domain error — already carries a stable code and a customer-safe message.
  if (isDomainError(err)) {
    logger?.info(
      { msg: 'request.domain_error', code: err.code, context: err.context },
      err.message,
    );

    return c.json(
      body(err.code, err.message, requestId, err.details),
      err.httpStatus as 400 | 401 | 403 | 404 | 409 | 422 | 426 | 429,
    );
  }

  // Hono's own HTTP exceptions (malformed JSON, method not allowed, ...).
  if (err instanceof HTTPException) {
    const code =
      err.status === 404
        ? 'NOT_FOUND'
        : err.status === 405
          ? 'METHOD_NOT_ALLOWED'
          : err.status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : err.status === 415
              ? 'UNSUPPORTED_MEDIA_TYPE'
              : 'VALIDATION_FAILED';

    return c.json(
      body(code, err.message || 'Request could not be processed.', requestId),
      err.status,
    );
  }

  // Anything else is a bug. Log everything, reveal nothing.
  logger?.error(
    {
      msg: 'request.unhandled_error',
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    },
    'unhandled error',
  );

  return c.json(
    body('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', requestId),
    500,
  );
};

export const notFoundHandler: NotFoundHandler<AppBindings> = (c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  return c.json(body('NOT_FOUND', 'The requested resource does not exist.', requestId), 404);
};
