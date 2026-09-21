/**
 * Serviceability rules.
 *
 * This module is PURE: no database, no HTTP, no clock, no configuration. It
 * receives the city and pincode records and returns a decision. That makes
 * every rule below exhaustively unit-testable in microseconds, and it is why
 * the decision can be trusted identically by the API, the worker and any
 * future mobile ops tool.
 *
 * The rule the whole business depends on: **serviceability is resolved from
 * data, never from a hard-coded list**. There is no `if (city === 'Noida')`
 * anywhere in this codebase, and adding a city is an admin action with no
 * deploy (BR-SV1).
 */

export type ServiceabilityStatus = 'ACTIVE' | 'INACTIVE' | 'COMING_SOON';

export type CityRecord = {
  id: string;
  name: string;
  slug: string;
  state: string;
  status: ServiceabilityStatus;
};

export type PincodeRecord = {
  id: string;
  pincode: string;
  areaName: string | null;
  status: ServiceabilityStatus;
  city: CityRecord;
};

export type NotServiceableReason =
  | 'PINCODE_NOT_FOUND'
  | 'PINCODE_INACTIVE'
  | 'CITY_INACTIVE'
  | 'CITY_COMING_SOON'
  | 'PINCODE_COMING_SOON';

export type ServiceabilityDecision =
  | {
      serviceable: true;
      pincode: string;
      city: CityRecord;
      areaName: string | null;
    }
  | {
      serviceable: false;
      pincode: string;
      reason: NotServiceableReason;
      /** Present when the pincode is known but not yet served — the caller may
       *  legitimately show the city name ("Greater Noida — coming soon"). */
      city: CityRecord | null;
      /** True when this is "not yet" rather than "no", which is worth
       *  capturing as a demand signal for expansion. */
      waitlistAvailable: boolean;
    };

/**
 * Resolve whether we deliver to a pincode.
 *
 * Evaluated city-first, then pincode. The order matters: if a whole city is
 * switched off, the reason should say so rather than blaming an individual
 * pincode, because that is the message the customer and the support agent
 * both need.
 *
 * @param pincode  the requested pincode, already format-validated
 * @param record   the matching pincode row, or null if we have never heard of it
 */
export function resolveServiceability(
  pincode: string,
  record: PincodeRecord | null,
): ServiceabilityDecision {
  if (!record) {
    return {
      serviceable: false,
      pincode,
      reason: 'PINCODE_NOT_FOUND',
      city: null,
      // We have no record at all, so we cannot promise anything. This is still
      // worth a waitlist capture: unknown pincodes are precisely the demand
      // signal that tells us where to expand next.
      waitlistAvailable: true,
    };
  }

  const { city } = record;

  // City gate first. A deactivated city overrides any pincode that was left
  // ACTIVE underneath it — switching off a city must be sufficient on its own,
  // without requiring the admin to also switch off every pincode in it.
  if (city.status === 'INACTIVE') {
    return {
      serviceable: false,
      pincode,
      reason: 'CITY_INACTIVE',
      city,
      waitlistAvailable: true,
    };
  }

  if (city.status === 'COMING_SOON') {
    return {
      serviceable: false,
      pincode,
      reason: 'CITY_COMING_SOON',
      city,
      waitlistAvailable: true,
    };
  }

  // City is ACTIVE — now the pincode decides.
  if (record.status === 'INACTIVE') {
    return {
      serviceable: false,
      pincode,
      reason: 'PINCODE_INACTIVE',
      city,
      waitlistAvailable: true,
    };
  }

  if (record.status === 'COMING_SOON') {
    return {
      serviceable: false,
      pincode,
      reason: 'PINCODE_COMING_SOON',
      city,
      waitlistAvailable: true,
    };
  }

  return {
    serviceable: true,
    pincode,
    city,
    areaName: record.areaName,
  };
}

/**
 * Customer-facing copy for a decision.
 *
 * Centralised so that every surface — customer app, marketing site, admin,
 * and later the mobile apps — says the same thing, and so that the wording
 * can be changed in one place (docs/17-DESIGN-SYSTEM.md §9).
 */
export function serviceabilityMessage(decision: ServiceabilityDecision, brand = 'Healthy Aahar') {
  if (decision.serviceable) {
    const where = decision.areaName
      ? `${decision.areaName}, ${decision.city.name}`
      : decision.city.name;
    return `Good news — ${brand} delivers to ${where}.`;
  }

  switch (decision.reason) {
    case 'PINCODE_NOT_FOUND':
      return `Sorry, ${brand} is not currently delivering to this location.`;
    case 'PINCODE_INACTIVE':
      return `Sorry, ${brand} is not delivering to ${decision.pincode} yet. We deliver elsewhere in ${decision.city?.name ?? 'this city'}.`;
    case 'CITY_INACTIVE':
      return `Sorry, ${brand} is not currently delivering in ${decision.city?.name ?? 'this city'}.`;
    case 'CITY_COMING_SOON':
      return `${brand} is coming to ${decision.city?.name ?? 'your city'} soon. Join the waitlist and we will tell you the day we launch.`;
    case 'PINCODE_COMING_SOON':
      return `${brand} is launching in ${decision.pincode} soon. Join the waitlist and we will tell you the day we launch.`;
  }
}

/**
 * A city may be activated only if it has at least one pincode to serve.
 * An active city with no active pincodes is serviceable in the admin UI and
 * unserviceable to every customer — the kind of inconsistency that produces
 * support tickets nobody can explain (BR-SV4).
 */
export function canActivateCity(activePincodeCount: number): { ok: boolean; reason?: string } {
  if (activePincodeCount === 0) {
    return {
      ok: false,
      reason:
        'A city needs at least one ACTIVE pincode before it can be activated, otherwise it would appear serviceable while accepting no addresses.',
    };
  }
  return { ok: true };
}

/**
 * A pincode may always be activated — but activating one inside a city that
 * is not ACTIVE does not make it serviceable, because the city gate runs
 * first (BR-SV9).
 *
 * This deliberately does NOT block. An earlier version refused activation
 * unless the city was already ACTIVE, which deadlocked against
 * `canActivateCity`: a city needs an ACTIVE pincode to activate, so a brand
 * new city could never be activated at all. Returning a warning instead
 * keeps the admin informed and the flow possible.
 */
export function canActivatePincode(cityStatus: ServiceabilityStatus): {
  ok: boolean;
  warning?: string;
} {
  if (cityStatus !== 'ACTIVE') {
    return {
      ok: true,
      warning: `This pincode will not be serviceable until its city is activated (city is currently ${cityStatus}).`,
    };
  }
  return { ok: true };
}
