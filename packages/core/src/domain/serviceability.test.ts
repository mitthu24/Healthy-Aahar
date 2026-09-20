import { describe, expect, it } from 'vitest';

import {
  canActivateCity,
  canActivatePincode,
  resolveServiceability,
  serviceabilityMessage,
  type CityRecord,
  type PincodeRecord,
  type ServiceabilityStatus,
} from './serviceability.js';

const city = (status: ServiceabilityStatus, name = 'Noida'): CityRecord => ({
  id: '0193aaaa-0000-7000-8000-000000000001',
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  state: 'Uttar Pradesh',
  status,
});

const pin = (
  pincodeStatus: ServiceabilityStatus,
  cityStatus: ServiceabilityStatus,
  pincode = '201301',
): PincodeRecord => ({
  id: '0193bbbb-0000-7000-8000-000000000001',
  pincode,
  areaName: 'Sector 1-18',
  status: pincodeStatus,
  city: city(cityStatus),
});

describe('resolveServiceability', () => {
  it('serves an active pincode in an active city', () => {
    const result = resolveServiceability('201301', pin('ACTIVE', 'ACTIVE'));

    expect(result.serviceable).toBe(true);
    if (result.serviceable) {
      expect(result.city.name).toBe('Noida');
      expect(result.areaName).toBe('Sector 1-18');
    }
  });

  it('rejects an unknown pincode and still offers the waitlist', () => {
    const result = resolveServiceability('999999', null);

    expect(result.serviceable).toBe(false);
    if (!result.serviceable) {
      expect(result.reason).toBe('PINCODE_NOT_FOUND');
      expect(result.city).toBeNull();
      // An unknown pincode is the clearest expansion signal we get.
      expect(result.waitlistAvailable).toBe(true);
    }
  });

  it('rejects an inactive pincode inside an active city', () => {
    const result = resolveServiceability('201305', pin('INACTIVE', 'ACTIVE', '201305'));

    expect(result.serviceable).toBe(false);
    if (!result.serviceable) {
      expect(result.reason).toBe('PINCODE_INACTIVE');
      // The city is still returned so the UI can say "we deliver elsewhere
      // in Noida" rather than implying we do not serve the city at all.
      expect(result.city?.name).toBe('Noida');
    }
  });

  it('rejects every pincode in an inactive city, even one left ACTIVE', () => {
    // This is the rule that makes switching a city off sufficient on its own.
    // Without it, an admin deactivating Noida would also have to remember to
    // deactivate each of its pincodes, and any one they missed would keep
    // silently accepting orders.
    const result = resolveServiceability('201301', pin('ACTIVE', 'INACTIVE'));

    expect(result.serviceable).toBe(false);
    if (!result.serviceable) {
      expect(result.reason).toBe('CITY_INACTIVE');
    }
  });

  it('reports a coming-soon city distinctly from an inactive one', () => {
    const result = resolveServiceability('201310', pin('ACTIVE', 'COMING_SOON', '201310'));

    expect(result.serviceable).toBe(false);
    if (!result.serviceable) {
      expect(result.reason).toBe('CITY_COMING_SOON');
      expect(result.waitlistAvailable).toBe(true);
    }
  });

  it('reports a coming-soon pincode in an active city', () => {
    const result = resolveServiceability('201309', pin('COMING_SOON', 'ACTIVE', '201309'));

    expect(result.serviceable).toBe(false);
    if (!result.serviceable) {
      expect(result.reason).toBe('PINCODE_COMING_SOON');
    }
  });

  it('decides purely from the supplied records, with no knowledge of any city', () => {
    // The guarantee behind BR-SV1: nothing in this function knows that Noida
    // is the launch city. A city invented at runtime resolves identically,
    // which is what makes admin-driven expansion work without a deploy.
    const invented: PincodeRecord = {
      id: '0193cccc-0000-7000-8000-000000000001',
      pincode: '560076',
      areaName: 'HSR Layout',
      status: 'ACTIVE',
      city: {
        id: '0193dddd-0000-7000-8000-000000000001',
        name: 'Bengaluru',
        slug: 'bengaluru',
        state: 'Karnataka',
        status: 'ACTIVE',
      },
    };

    const result = resolveServiceability('560076', invented);
    expect(result.serviceable).toBe(true);
  });

  it.each([
    ['ACTIVE', 'ACTIVE', true],
    ['ACTIVE', 'INACTIVE', false],
    ['ACTIVE', 'COMING_SOON', false],
    ['INACTIVE', 'ACTIVE', false],
    ['INACTIVE', 'INACTIVE', false],
    ['INACTIVE', 'COMING_SOON', false],
    ['COMING_SOON', 'ACTIVE', false],
    ['COMING_SOON', 'INACTIVE', false],
    ['COMING_SOON', 'COMING_SOON', false],
  ] as const)('pincode=%s city=%s serviceable=%s', (pincodeStatus, cityStatus, expected) => {
    const result = resolveServiceability('201301', pin(pincodeStatus, cityStatus));
    expect(result.serviceable).toBe(expected);
  });
});

describe('serviceabilityMessage', () => {
  it('names the area when we deliver', () => {
    const message = serviceabilityMessage(resolveServiceability('201301', pin('ACTIVE', 'ACTIVE')));
    expect(message).toContain('Sector 1-18');
    expect(message).toContain('Noida');
  });

  it('gives the documented refusal wording for an unknown location', () => {
    const message = serviceabilityMessage(resolveServiceability('999999', null));
    expect(message).toBe('Sorry, Healthy Aahar is not currently delivering to this location.');
  });

  it('distinguishes "not yet" from "no"', () => {
    const comingSoon = serviceabilityMessage(
      resolveServiceability('201310', pin('ACTIVE', 'COMING_SOON')),
    );
    const inactive = serviceabilityMessage(
      resolveServiceability('201301', pin('ACTIVE', 'INACTIVE')),
    );

    expect(comingSoon).toContain('waitlist');
    expect(inactive).not.toContain('waitlist');
  });

  it('accepts a brand override so the copy is not hard-coded either', () => {
    const message = serviceabilityMessage(resolveServiceability('999999', null), 'Test Brand');
    expect(message).toContain('Test Brand');
  });
});

describe('activation guards', () => {
  it('refuses to activate a city with no active pincodes', () => {
    const result = canActivateCity(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('at least one ACTIVE pincode');
  });

  it('allows activating a city that has active pincodes', () => {
    expect(canActivateCity(3).ok).toBe(true);
  });

  it('refuses to activate a pincode whose city is not active', () => {
    expect(canActivatePincode('INACTIVE').ok).toBe(false);
    expect(canActivatePincode('COMING_SOON').ok).toBe(false);
  });

  it('allows activating a pincode in an active city', () => {
    expect(canActivatePincode('ACTIVE').ok).toBe(true);
  });
});

describe('serviceabilityMessage fallbacks', () => {
  it('degrades gracefully when a decision carries no city', () => {
    // Defensive: the resolver always supplies a city for these reasons, but a
    // message helper that throws on null would turn a minor inconsistency
    // into a 500 on the customer's first interaction with the brand.
    const noCity = {
      serviceable: false as const,
      pincode: '201301',
      reason: 'PINCODE_INACTIVE' as const,
      city: null,
      waitlistAvailable: true,
    };
    expect(serviceabilityMessage(noCity)).toContain('this city');

    const noCityCityLevel = { ...noCity, reason: 'CITY_INACTIVE' as const };
    expect(serviceabilityMessage(noCityCityLevel)).toContain('this city');

    const comingSoon = { ...noCity, reason: 'CITY_COMING_SOON' as const };
    expect(serviceabilityMessage(comingSoon)).toContain('your city');
  });

  it('names the city without an area when none is recorded', () => {
    const result = resolveServiceability('201301', {
      ...pin('ACTIVE', 'ACTIVE'),
      areaName: null,
    });
    expect(serviceabilityMessage(result)).toContain('Noida');
  });
});
