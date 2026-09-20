import { describe, expect, it } from 'vitest';

import { businessScope, assertInScope, notFoundInScope } from './business-scope.js';
import { DomainError } from './errors.js';
import {
  buildPage,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
  normaliseLimit,
} from './pagination.js';

describe('cursor encoding', () => {
  it('round-trips a cursor', () => {
    const cursor = {
      sortValue: '2026-09-20T10:00:00Z',
      id: '0193aaaa-0000-7000-8000-000000000001',
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('produces an opaque value that is not the raw id', () => {
    // A client that parses the cursor couples itself to our sort order and
    // breaks the moment we change it.
    const encoded = encodeCursor({ sortValue: 'a', id: 'b' });
    expect(encoded).not.toContain('sortValue');
    expect(encoded).not.toBe('b');
  });

  it('is URL-safe', () => {
    const encoded = encodeCursor({ sortValue: 'a+b/c=d', id: 'x'.repeat(40) });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each(['not-base64!!', '', 'eyJub3QiOiJhbiBhcnJheSJ9', 'WyJvbmx5b25lIl0='])(
    'rejects malformed cursor %s with a client error',
    (bad) => {
      // A bad cursor is a client bug. Saying so beats returning a confusing
      // empty page.
      try {
        decodeCursor(bad);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).httpStatus).toBe(422);
      }
    },
  );
});

describe('buildPage', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `id-${i}`, order: i }));
  const toCursor = (r: { id: string; order: number }) => ({ sortValue: String(r.order), id: r.id });

  it('trims the extra row and reports has_more', () => {
    // Fetching limit+1 is how has_more is known without a COUNT query.
    const page = buildPage(rows, 5, toCursor);

    expect(page.data).toHaveLength(5);
    expect(page.pagination.has_more).toBe(true);
    expect(page.pagination.next_cursor).not.toBeNull();
  });

  it('reports the last page correctly', () => {
    const page = buildPage(rows.slice(0, 3), 5, toCursor);

    expect(page.data).toHaveLength(3);
    expect(page.pagination.has_more).toBe(false);
    expect(page.pagination.next_cursor).toBeNull();
  });

  it('handles an empty result', () => {
    const page = buildPage([], 5, toCursor);

    expect(page.data).toEqual([]);
    expect(page.pagination.has_more).toBe(false);
    expect(page.pagination.next_cursor).toBeNull();
  });

  it('points the next cursor at the last returned row, not the extra one', () => {
    // Off-by-one here silently skips a record on every page boundary.
    const page = buildPage(rows, 5, toCursor);
    expect(decodeCursor(page.pagination.next_cursor!)).toEqual({ sortValue: '4', id: 'id-4' });
  });
});

describe('normaliseLimit', () => {
  it('defaults when absent', () => {
    expect(normaliseLimit(undefined)).toBe(20);
  });

  it('caps so no caller can request an unbounded page', () => {
    expect(normaliseLimit(10_000)).toBe(MAX_PAGE_LIMIT);
  });

  it.each([0, -1, 1.5])('rejects %s', (bad) => {
    expect(() => normaliseLimit(bad)).toThrow(DomainError);
  });
});

describe('business scope', () => {
  const scope = businessScope('0193aaaa-0000-7000-8000-00000000000b');

  it('rejects an empty business id', () => {
    expect(() => businessScope('')).toThrow(DomainError);
    expect(() => businessScope('   ')).toThrow(DomainError);
  });

  it('passes a row from the same business', () => {
    expect(() =>
      assertInScope({ businessId: '0193aaaa-0000-7000-8000-00000000000b' }, scope, 'City'),
    ).not.toThrow();
  });

  it('rejects a row from another business as NOT_FOUND, never FORBIDDEN', () => {
    // A 403 would confirm the resource exists, which is an enumeration
    // oracle (docs/06 §1.6).
    try {
      assertInScope({ businessId: 'some-other-business' }, scope, 'City');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('NOT_FOUND');
      expect((error as DomainError).httpStatus).toBe(404);
    }
  });

  it('treats a missing row as nothing to assert', () => {
    expect(() => assertInScope(null, scope, 'City')).not.toThrow();
  });

  it('notFoundInScope never leaks the business id into the message', () => {
    const error = notFoundInScope('City');
    expect(error.message).toBe('City not found.');
    expect(error.message).not.toContain(scope);
  });
});
