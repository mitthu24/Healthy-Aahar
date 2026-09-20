import { describe, expect, it } from 'vitest';

import { DomainError } from '../domain/errors.js';
import type { CityRecord, PincodeRecord } from '../domain/serviceability.js';
import type { ServiceabilityRepository } from '../ports/serviceability-repository.js';
import { ServiceabilityService } from './serviceability-service.js';

const BUSINESS_ID = '0193aaaa-0000-7000-8000-00000000000b';

const noida: CityRecord = {
  id: '0193aaaa-0000-7000-8000-000000000001',
  name: 'Noida',
  slug: 'noida',
  state: 'Uttar Pradesh',
  status: 'ACTIVE',
};

/**
 * In-memory repository. The port exists precisely so the service can be tested
 * without a database — these tests run in single-digit milliseconds.
 */
class FakeRepository implements ServiceabilityRepository {
  constructor(private readonly pincodes: PincodeRecord[]) {}

  async findPincode(_businessId: string, pincode: string): Promise<PincodeRecord | null> {
    return this.pincodes.find((p) => p.pincode === pincode) ?? null;
  }

  async listCities(): Promise<CityRecord[]> {
    return [noida];
  }

  async listPincodesByCity(): Promise<PincodeRecord[]> {
    return this.pincodes;
  }

  async countActivePincodes(): Promise<number> {
    return this.pincodes.filter((p) => p.status === 'ACTIVE').length;
  }
}

function service(pincodes: PincodeRecord[]): ServiceabilityService {
  return new ServiceabilityService({ repository: new FakeRepository(pincodes) });
}

const activePin: PincodeRecord = {
  id: '0193bbbb-0000-7000-8000-000000000001',
  pincode: '201301',
  areaName: 'Sector 1-18',
  status: 'ACTIVE',
  city: noida,
};

const inactivePin: PincodeRecord = {
  ...activePin,
  id: '0193bbbb-0000-7000-8000-000000000002',
  pincode: '201305',
  areaName: 'Sector 63-80',
  status: 'INACTIVE',
};

describe('ServiceabilityService.checkForApi', () => {
  it('returns a serviceable response with the city', async () => {
    const result = await service([activePin]).checkForApi(BUSINESS_ID, '201301');

    expect(result.is_serviceable).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.city?.name).toBe('Noida');
    expect(result.area_name).toBe('Sector 1-18');
    expect(result.waitlist_available).toBe(false);
  });

  it('answers a non-serviceable pincode successfully rather than as an error', async () => {
    // A 404 would be semantically wrong: the question was answered. See
    // docs/06-API-SPECIFICATION.md §4.
    const result = await service([inactivePin]).checkForApi(BUSINESS_ID, '201305');

    expect(result.is_serviceable).toBe(false);
    expect(result.reason).toBe('PINCODE_INACTIVE');
    expect(result.waitlist_available).toBe(true);
    expect(result.message).toContain('201305');
  });

  it('handles an entirely unknown pincode', async () => {
    const result = await service([activePin]).checkForApi(BUSINESS_ID, '999999');

    expect(result.is_serviceable).toBe(false);
    expect(result.reason).toBe('PINCODE_NOT_FOUND');
    expect(result.city).toBeNull();
  });

  it('trims surrounding whitespace from user input', async () => {
    const result = await service([activePin]).checkForApi(BUSINESS_ID, '  201301  ');
    expect(result.is_serviceable).toBe(true);
  });

  it.each(['20130', '2013011', 'abcdef', '001301', ''])(
    'rejects malformed pincode %s with INVALID_PINCODE',
    async (bad) => {
      await expect(service([activePin]).checkForApi(BUSINESS_ID, bad)).rejects.toBeInstanceOf(
        DomainError,
      );
    },
  );
});

describe('ServiceabilityService.assertServiceable', () => {
  it('passes for a serviceable pincode', async () => {
    await expect(
      service([activePin]).assertServiceable(BUSINESS_ID, '201301'),
    ).resolves.toBeUndefined();
  });

  it('throws ADDRESS_NOT_SERVICEABLE for an inactive pincode', async () => {
    // This is the checkout guard. An address saved months ago may have become
    // unserviceable since, and the customer must not be able to order into it.
    const promise = service([inactivePin]).assertServiceable(BUSINESS_ID, '201305');

    await expect(promise).rejects.toMatchObject({
      code: 'ADDRESS_NOT_SERVICEABLE',
      httpStatus: 422,
    });
  });

  it('never consults a caller-supplied serviceability flag', async () => {
    // There is deliberately no parameter through which a client could assert
    // serviceability. The backend recomputes it every time (BR-SV1).
    const svc = service([inactivePin]);
    const signature = svc.assertServiceable.length;

    expect(signature).toBe(2); // (businessId, pincode) only
    await expect(svc.assertServiceable(BUSINESS_ID, '201305')).rejects.toBeInstanceOf(DomainError);
  });
});
