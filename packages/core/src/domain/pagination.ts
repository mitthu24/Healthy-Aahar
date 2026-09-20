import { DomainError } from './errors.js';

/**
 * Cursor pagination.
 *
 * Never offset. Offset pagination skips or repeats rows when the underlying
 * set changes between pages, which is unacceptable on a list that is actively
 * being written — an order list, a delivery schedule (docs/06 §1.3).
 *
 * The cursor encodes the full sort key, not just an id, so it remains stable
 * for any ordering the endpoint offers.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export type Cursor = {
  /** Value of the primary sort column at the boundary row. */
  sortValue: string;
  /** Tie-breaker. Two rows can share a timestamp; ids are unique. */
  id: string;
};

/**
 * Encode a cursor as opaque base64url.
 *
 * Opaque by intent: a client that parses the cursor couples itself to our
 * sort implementation and breaks the moment we change it.
 */
export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify([cursor.sortValue, cursor.id]);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string): Cursor {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    ) {
      throw new Error('malformed');
    }

    return { sortValue: parsed[0], id: parsed[1] };
  } catch {
    // A bad cursor is a client bug, not a server error. Say so precisely
    // rather than returning a confusing empty page.
    throw new DomainError('VALIDATION_FAILED', 'The pagination cursor is not valid.', {
      details: [{ field: 'cursor', issue: 'Cursor is malformed or was not produced by this API' }],
    });
  }
}

export type PageRequest = {
  limit: number;
  cursor?: string | undefined;
};

export type Page<T> = {
  data: T[];
  pagination: {
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
  };
};

/**
 * Build a page from rows fetched with `limit + 1`.
 *
 * Fetching one extra row is how `has_more` is determined without a second
 * COUNT query — which on a large table would cost more than the page itself.
 */
export function buildPage<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];

  return {
    data,
    pagination: {
      limit,
      next_cursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
      has_more: hasMore,
    },
  };
}

export function normaliseLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DomainError('VALIDATION_FAILED', 'Limit must be a positive whole number.', {
      details: [{ field: 'limit', issue: `Received ${String(limit)}` }],
    });
  }
  return Math.min(limit, MAX_PAGE_LIMIT);
}
