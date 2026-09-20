import { describe, expect, it } from 'vitest';

import { DomainError, forbidden, isDomainError, notFound, validationFailed } from './errors.js';
import { isUuidV7, isValidId, newId } from './ids.js';

describe('newId', () => {
  it('generates a valid UUIDv7', () => {
    const id = newId();
    expect(isValidId(id)).toBe(true);
    expect(isUuidV7(id)).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it('generates time-ordered ids', () => {
    // The property that makes UUIDv7 worth choosing over v4: lexicographic
    // order matches creation order, so B-tree inserts stay local on hot
    // tables instead of scattering (ADR-012).
    const first = newId();
    const later = Array.from({ length: 50 }, () => newId());
    const sorted = [...later].sort();

    expect(sorted).toEqual(later);
    expect(first < later[0]!).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(isValidId('not-a-uuid')).toBe(false);
    expect(isValidId('')).toBe(false);
  });

  it('distinguishes v7 from v4', () => {
    // A v4 id signals that something generated an identifier outside our
    // helpers, which is worth catching at a trust boundary.
    const v4 = '9f1c5d2e-4a3b-4c5d-8e6f-7a8b9c0d1e2f';
    expect(isValidId(v4)).toBe(true);
    expect(isUuidV7(v4)).toBe(false);
  });
});

describe('DomainError', () => {
  it('carries the HTTP status for its code', () => {
    const error = new DomainError('ADDRESS_NOT_SERVICEABLE', 'We do not deliver there');

    expect(error.code).toBe('ADDRESS_NOT_SERVICEABLE');
    expect(error.httpStatus).toBe(422);
    expect(error.name).toBe('DomainError');
  });

  it('carries field details and log-only context', () => {
    const error = new DomainError('INVALID_PINCODE', 'Bad pincode', {
      details: [{ field: 'pincode', issue: 'Expected 6 digits' }],
      context: { pincode: '123' },
    });

    expect(error.details).toHaveLength(1);
    expect(error.context).toEqual({ pincode: '123' });
  });

  it('preserves a cause', () => {
    const cause = new Error('underlying');
    const error = new DomainError('INTERNAL_ERROR', 'Wrapped', { cause });
    expect(error.cause).toBe(cause);
  });

  it('is recognised by isDomainError and not confused with a plain Error', () => {
    expect(isDomainError(new DomainError('NOT_FOUND', 'x'))).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError('NOT_FOUND')).toBe(false);
  });
});

describe('error helpers', () => {
  it('notFound defaults to 404', () => {
    expect(notFound().httpStatus).toBe(404);
    expect(notFound('Order not found').message).toBe('Order not found');
  });

  it('forbidden defaults to 403', () => {
    expect(forbidden().httpStatus).toBe(403);
  });

  it('validationFailed carries details and 422', () => {
    const error = validationFailed('Bad input', [{ field: 'pincode', issue: 'required' }]);
    expect(error.httpStatus).toBe(422);
    expect(error.details?.[0]?.field).toBe('pincode');
  });
});
