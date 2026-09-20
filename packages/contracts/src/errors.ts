import { z } from 'zod';

/**
 * The error-code catalogue from docs/06-API-SPECIFICATION.md §15.
 *
 * Clients branch on `code`, never on `message`. A message may be reworded at
 * any time; a code is part of the API contract and changing one is a breaking
 * change requiring a version bump (docs/30 §5).
 *
 * PHASE 01 defines the full catalogue up front, because codes are a contract
 * and retrofitting them across shipped mobile clients is impossible. Codes for
 * later phases are listed here and simply not raised yet.
 */
export const ERROR_CODES = {
  // ── Generic ─────────────────────────────────────────────────────────────
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,

  // ── Authentication / authorization ──────────────────────────────────────
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  WRONG_AUDIENCE: 401,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  CLIENT_UPGRADE_REQUIRED: 426,

  // ── Serviceability (PHASE 01) ───────────────────────────────────────────
  CITY_NOT_FOUND: 404,
  PINCODE_NOT_FOUND: 404,
  ADDRESS_NOT_SERVICEABLE: 422,
  CITY_INACTIVE: 409,
  PINCODE_INACTIVE: 409,
  PINCODE_ALREADY_ASSIGNED: 409,
  CITY_HAS_ACTIVE_PINCODES: 409,
  INVALID_PINCODE: 422,

  // ── Catalogue (PHASE 05) ────────────────────────────────────────────────
  PRODUCT_NOT_FOUND: 404,
  VARIANT_NOT_FOUND: 404,
  ITEM_NOT_AVAILABLE: 409,
  COMBO_COMPONENT_UNAVAILABLE: 409,
  INVALID_SORT_FIELD: 422,
  INVALID_PRICE_RANGE: 422,
  SEARCH_QUERY_TOO_SHORT: 400,

  // ── Cart / checkout / orders (PHASE 07) ─────────────────────────────────
  CART_EMPTY: 400,
  AMBIGUOUS_CART_ITEM: 400,
  INSUFFICIENT_STOCK: 409,
  MAX_QUANTITY_EXCEEDED: 422,
  INVALID_QUANTITY: 422,
  PRICE_CHANGED: 409,
  MIN_ORDER_NOT_MET: 422,
  ADDRESS_IN_USE_BY_SUBSCRIPTION: 409,
  ADDRESS_LIMIT_REACHED: 409,
  ORDER_NOT_CANCELLABLE: 409,
  INVALID_STATUS_TRANSITION: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENT_REQUEST_IN_PROGRESS: 409,

  // ── Delivery slots (PHASE 06) ───────────────────────────────────────────
  SLOT_CUTOFF_PASSED: 409,
  SLOT_CAPACITY_EXCEEDED: 409,
  SLOT_BLOCKED: 409,
  SLOT_NOT_AVAILABLE_ON_DAY: 422,
  SLOT_IN_USE: 409,

  // ── Subscriptions (PHASE 09) ────────────────────────────────────────────
  SUBSCRIPTION_NOT_ACTIVE: 409,
  PAUSE_LIMIT_EXCEEDED: 422,
  PAUSE_NOTICE_TOO_SHORT: 422,
  INVALID_PAUSE_WINDOW: 422,
  SKIP_LIMIT_EXCEEDED: 422,
  SKIP_DEADLINE_PASSED: 409,
  DELIVERY_NOT_SKIPPABLE: 409,
  ALREADY_MATERIALISED: 409,
  MIN_DURATION_NOT_MET: 409,
  PLAN_INACTIVE: 409,
  DUPLICATE_SUBSCRIPTION: 409,
  INVALID_START_DATE: 422,
  INVALID_DELIVERY_DAYS: 422,
  SLOT_NOT_ALLOWED_BY_PLAN: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function httpStatusForErrorCode(code: ErrorCode): number {
  return ERROR_CODES[code];
}

export const errorDetailSchema = z.object({
  field: z.string().optional(),
  issue: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
    request_id: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ErrorDetail = z.infer<typeof errorDetailSchema>;
