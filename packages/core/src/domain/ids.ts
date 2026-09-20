import { v7 as uuidv7, validate as uuidValidate, version as uuidVersion } from 'uuid';

/**
 * Identifiers.
 *
 * UUIDv7 (ADR-012): time-ordered, so it keeps B-tree insert locality on hot
 * tables, while staying opaque in URLs so order volume cannot be inferred by
 * enumerating ids.
 *
 * Generated in the application rather than the database so a whole aggregate
 * (order + items + status row + outbox event) can be constructed in memory
 * before the transaction commits.
 */
export function newId(): string {
  return uuidv7();
}

export function isValidId(value: string): boolean {
  return uuidValidate(value);
}

/** UUIDv7 only. Used at trust boundaries where a v4 would signal that
 *  something generated an id outside our helpers. */
export function isUuidV7(value: string): boolean {
  return uuidValidate(value) && uuidVersion(value) === 7;
}
