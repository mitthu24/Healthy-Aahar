import type { ServiceabilityResponse } from '@healthy-aahar/contracts';

import { DomainError } from '../domain/errors.js';
import {
  resolveServiceability,
  serviceabilityMessage,
  type ServiceabilityDecision,
} from '../domain/serviceability.js';
import type { ServiceabilityRepository } from '../ports/serviceability-repository.js';

const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export type ServiceabilityServiceDeps = {
  repository: ServiceabilityRepository;
  brandName?: string;
};

/**
 * Application service for serviceability.
 *
 * Note what this does NOT do: it never accepts a serviceability flag from a
 * caller. The client may ask "is 201301 serviceable?" but may never assert
 * that it is. A frontend-supplied `isServiceable: true` is ignored because it
 * is never read — the answer is always recomputed from the database here.
 * That is the difference between a check and a claim.
 */
export class ServiceabilityService {
  private readonly repository: ServiceabilityRepository;
  private readonly brandName: string;

  constructor({ repository, brandName = 'Healthy Aahar' }: ServiceabilityServiceDeps) {
    this.repository = repository;
    this.brandName = brandName;
  }

  /** Raw domain decision — use this from other services. */
  async check(businessId: string, rawPincode: string): Promise<ServiceabilityDecision> {
    const pincode = rawPincode.trim();

    if (!PINCODE_PATTERN.test(pincode)) {
      throw new DomainError('INVALID_PINCODE', 'Pincode must be 6 digits and cannot start with 0', {
        details: [{ field: 'pincode', issue: 'Expected format: 201301' }],
      });
    }

    const record = await this.repository.findPincode(businessId, pincode);
    return resolveServiceability(pincode, record);
  }

  /** API-shaped response for `GET /v1/public/serviceability`. */
  async checkForApi(businessId: string, rawPincode: string): Promise<ServiceabilityResponse> {
    const decision = await this.check(businessId, rawPincode);
    const message = serviceabilityMessage(decision, this.brandName);

    if (decision.serviceable) {
      return {
        pincode: decision.pincode,
        is_serviceable: true,
        reason: null,
        message,
        city: {
          id: decision.city.id,
          name: decision.city.name,
          slug: decision.city.slug,
          state: decision.city.state,
        },
        area_name: decision.areaName,
        waitlist_available: false,
      };
    }

    return {
      pincode: decision.pincode,
      is_serviceable: false,
      reason: decision.reason,
      message,
      city: decision.city
        ? {
            id: decision.city.id,
            name: decision.city.name,
            slug: decision.city.slug,
            state: decision.city.state,
          }
        : null,
      area_name: null,
      waitlist_available: decision.waitlistAvailable,
    };
  }

  /**
   * Assert that an address may be delivered to, for use at checkout.
   *
   * Checkout calls this rather than trusting anything the client sent. An
   * address saved months ago may since have become unserviceable because an
   * admin switched a pincode or a whole city off, and the customer must not
   * be able to order into it (BR-D1, BR-SV1).
   */
  async assertServiceable(businessId: string, pincode: string): Promise<void> {
    const decision = await this.check(businessId, pincode);
    if (!decision.serviceable) {
      throw new DomainError(
        'ADDRESS_NOT_SERVICEABLE',
        serviceabilityMessage(decision, this.brandName),
        {
          details: [{ field: 'pincode', issue: decision.reason }],
          context: { pincode, reason: decision.reason, cityId: decision.city?.id },
        },
      );
    }
  }
}
