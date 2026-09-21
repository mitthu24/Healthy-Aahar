import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { buildPage, decodeCursor, type Page } from '../domain/pagination.js';
import { canActivateCity, canActivatePincode } from '../domain/serviceability.js';
import type {
  CityListFilter,
  CityRepository,
  CityRow,
  CreateCityInput,
  CreatePincodeInput,
  PincodeListFilter,
  PincodeRepository,
  PincodeRow,
  UpdateCityInput,
  UpdatePincodeInput,
} from '../ports/serviceability-admin-repository.js';

export type ServiceabilityAdminDeps = {
  cities: CityRepository;
  pincodes: PincodeRepository;
};

const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

/**
 * Admin management of cities and pincodes.
 *
 * This is the service that makes serviceability admin-controlled: every rule
 * that decides where Healthy Aahar delivers lives here and reads from the
 * database. There is no city list and no pincode list in the codebase
 * (BR-SV1).
 *
 * Status is NEVER set through create or update — activation and deactivation
 * are separate, guarded, audited operations, because deactivating a city
 * stops revenue from an entire market and deserves more than being a field
 * in a form submission (BR-SV5).
 */
export class ServiceabilityAdminService {
  private readonly cities: CityRepository;
  private readonly pincodes: PincodeRepository;

  constructor({ cities, pincodes }: ServiceabilityAdminDeps) {
    this.cities = cities;
    this.pincodes = pincodes;
  }

  // ── Cities ─────────────────────────────────────────────────────────────

  async listCities(
    scope: BusinessScope,
    filter: { status?: string; state?: string; q?: string; limit: number; cursor?: string },
  ): Promise<Page<CityRow>> {
    const repoFilter: CityListFilter = {
      limit: filter.limit,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      ...(filter.status ? { status: filter.status as CityRow['status'] } : {}),
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.q ? { q: filter.q } : {}),
    };

    // One extra row tells us whether another page exists without a COUNT.
    const rows = await this.cities.list(scope, { ...repoFilter, limit: filter.limit + 1 });

    return buildPage(rows, filter.limit, (row) => ({
      sortValue: String(row.displayOrder),
      id: row.id,
    }));
  }

  async getCity(scope: BusinessScope, id: string): Promise<CityRow> {
    const city = await this.cities.findById(scope, id);
    // Not found and not-yours are the same answer, so an id cannot be probed
    // across businesses (docs/06 §1.6).
    if (!city) throw new DomainError('CITY_NOT_FOUND', 'City not found.');
    return city;
  }

  async createCity(scope: BusinessScope, input: CreateCityInput): Promise<CityRow> {
    const existing = await this.cities.findBySlug(scope, input.slug);
    if (existing) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `A city with slug "${input.slug}" already exists.`,
        {
          details: [{ field: 'slug', issue: 'Must be unique within the business' }],
        },
      );
    }

    // Always created INACTIVE. A city becomes serviceable only through an
    // explicit activation that checks it has pincodes to serve (BR-SV4).
    return this.cities.create(scope, input);
  }

  async updateCity(scope: BusinessScope, id: string, input: UpdateCityInput): Promise<CityRow> {
    await this.getCity(scope, id);
    return this.cities.update(scope, id, input);
  }

  async activateCity(scope: BusinessScope, id: string, actorUserId?: string): Promise<CityRow> {
    const city = await this.getCity(scope, id);

    const activePincodes = await this.cities.countActivePincodes(scope, id);
    const check = canActivateCity(activePincodes);

    if (!check.ok) {
      // An active city with no active pincodes looks serviceable in admin and
      // is unserviceable to every customer — the kind of inconsistency that
      // produces support tickets nobody can explain.
      throw new DomainError('CITY_HAS_ACTIVE_PINCODES', check.reason ?? 'Cannot activate city.', {
        details: [{ field: 'status', issue: check.reason ?? '' }],
        context: { cityId: id, activePincodes },
      });
    }

    if (city.status === 'ACTIVE') return city;
    return this.cities.setStatus(scope, id, 'ACTIVE', actorUserId);
  }

  /**
   * Deactivating a city stops ALL new serviceability inside it, including
   * pincodes left ACTIVE beneath it — the city gate is evaluated first
   * (BR-SV9). Nothing is deleted (BR-SV6).
   */
  async deactivateCity(
    scope: BusinessScope,
    id: string,
    reason: string,
    actorUserId?: string,
  ): Promise<CityRow> {
    await this.getCity(scope, id);
    if (!reason || reason.trim().length < 3) {
      throw new DomainError('VALIDATION_FAILED', 'A reason is required to deactivate a city.', {
        details: [{ field: 'reason', issue: 'At least 3 characters' }],
      });
    }
    return this.cities.setStatus(scope, id, 'INACTIVE', actorUserId);
  }

  // ── Pincodes ───────────────────────────────────────────────────────────

  async listPincodes(
    scope: BusinessScope,
    filter: { cityId?: string; status?: string; q?: string; limit: number; cursor?: string },
  ): Promise<Page<PincodeRow>> {
    const repoFilter: PincodeListFilter = {
      limit: filter.limit + 1,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      ...(filter.cityId ? { cityId: filter.cityId } : {}),
      ...(filter.status ? { status: filter.status as PincodeRow['status'] } : {}),
      ...(filter.q ? { q: filter.q } : {}),
    };

    const rows = await this.pincodes.list(scope, repoFilter);

    return buildPage(rows, filter.limit, (row) => ({
      sortValue: row.pincode,
      id: row.id,
    }));
  }

  async getPincode(scope: BusinessScope, id: string): Promise<PincodeRow> {
    const pincode = await this.pincodes.findById(scope, id);
    if (!pincode) throw new DomainError('PINCODE_NOT_FOUND', 'Pincode not found.');
    return pincode;
  }

  async createPincode(scope: BusinessScope, input: CreatePincodeInput): Promise<PincodeRow> {
    if (!PINCODE_PATTERN.test(input.pincode)) {
      throw new DomainError(
        'INVALID_PINCODE',
        'Pincode must be 6 digits and cannot start with 0.',
        {
          details: [{ field: 'pincode', issue: 'Expected format: 201301' }],
        },
      );
    }

    // The city must exist AND belong to this business. getCity enforces both,
    // so a pincode can never be attached across a tenant boundary (BR-SV3).
    await this.getCity(scope, input.cityId);

    const existing = await this.pincodes.findByPincode(scope, input.pincode);
    if (existing) {
      // A pincode resolves to exactly one city, which is what keeps
      // serviceability deterministic (BR-SV2).
      throw new DomainError(
        'PINCODE_ALREADY_ASSIGNED',
        `Pincode ${input.pincode} is already assigned to ${existing.city.name}.`,
        {
          details: [{ field: 'pincode', issue: 'Already assigned within this business' }],
          context: { existingCityId: existing.cityId },
        },
      );
    }

    return this.pincodes.create(scope, input);
  }

  async updatePincode(
    scope: BusinessScope,
    id: string,
    input: UpdatePincodeInput,
  ): Promise<PincodeRow> {
    await this.getPincode(scope, id);
    if (input.cityId) await this.getCity(scope, input.cityId);
    return this.pincodes.update(scope, id, input);
  }

  async activatePincode(
    scope: BusinessScope,
    id: string,
    actorUserId?: string,
  ): Promise<{ pincode: PincodeRow; warning?: string }> {
    const existing = await this.getPincode(scope, id);
    const check = canActivatePincode(existing.city.status);

    // Never blocks: an ACTIVE pincode in a non-ACTIVE city is simply not
    // serviceable, because the city gate is evaluated first (BR-SV9).
    // Blocking here would deadlock against canActivateCity.
    const pincode =
      existing.status === 'ACTIVE'
        ? existing
        : await this.pincodes.setStatus(scope, id, 'ACTIVE', actorUserId);

    return check.warning ? { pincode, warning: check.warning } : { pincode };
  }

  async deactivatePincode(
    scope: BusinessScope,
    id: string,
    reason: string,
    actorUserId?: string,
  ): Promise<PincodeRow> {
    await this.getPincode(scope, id);
    if (!reason || reason.trim().length < 3) {
      throw new DomainError('VALIDATION_FAILED', 'A reason is required to deactivate a pincode.', {
        details: [{ field: 'reason', issue: 'At least 3 characters' }],
      });
    }
    return this.pincodes.setStatus(scope, id, 'INACTIVE', actorUserId);
  }
}
