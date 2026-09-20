import type { CityRecord, PincodeRecord } from '../domain/serviceability.js';

/**
 * Persistence port for serviceability.
 *
 * The application service depends on this interface, not on Prisma. That is
 * what lets the serviceability rules be tested against an in-memory fake in
 * microseconds, and what would let the storage engine change without touching
 * a single business rule (docs/02-SYSTEM-ARCHITECTURE.md §4, §5).
 */
export interface ServiceabilityRepository {
  /**
   * Find a pincode with its city, scoped to a business.
   * Returns null when the pincode has never been registered.
   */
  findPincode(businessId: string, pincode: string): Promise<PincodeRecord | null>;

  /** Cities for a business, optionally filtered by status. */
  listCities(
    businessId: string,
    filter?: { status?: CityRecord['status']; state?: string },
  ): Promise<CityRecord[]>;

  /** Pincodes belonging to one city. */
  listPincodesByCity(
    businessId: string,
    cityId: string,
    filter?: { status?: PincodeRecord['status'] },
  ): Promise<PincodeRecord[]>;

  /** Count of ACTIVE pincodes in a city — used to guard city activation. */
  countActivePincodes(businessId: string, cityId: string): Promise<number>;
}
