import type { BusinessScope } from '../domain/business-scope.js';
import type { Cursor } from '../domain/pagination.js';
import type { ServiceabilityStatus } from '../domain/serviceability.js';

/**
 * Admin persistence ports for cities and pincodes.
 *
 * Every method takes a `BusinessScope` — not an optional filter, a required
 * first argument. Scoping is therefore impossible to omit at a call site,
 * and the type checker enforces it (ADR-005, docs/23 §4).
 */

export type CityRow = {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  displayName: string | null;
  state: string;
  country: string;
  timezone: string;
  status: ServiceabilityStatus;
  displayOrder: number;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  pincodeCount: number;
  activePincodeCount: number;
};

export type PincodeRow = {
  id: string;
  businessId: string;
  cityId: string;
  pincode: string;
  areaName: string | null;
  status: ServiceabilityStatus;
  displayOrder: number;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  city: { id: string; name: string; slug: string; state: string; status: ServiceabilityStatus };
};

export type CityListFilter = {
  status?: ServiceabilityStatus;
  state?: string;
  q?: string;
  limit: number;
  cursor?: Cursor | undefined;
};

export type PincodeListFilter = {
  cityId?: string;
  status?: ServiceabilityStatus;
  q?: string;
  limit: number;
  cursor?: Cursor | undefined;
};

export type CreateCityInput = {
  name: string;
  slug: string;
  displayName?: string | undefined;
  state: string;
  country: string;
  timezone: string;
  displayOrder: number;
  actorUserId?: string | undefined;
};

export type UpdateCityInput = Partial<Omit<CreateCityInput, 'slug'>>;

export type CreatePincodeInput = {
  cityId: string;
  pincode: string;
  areaName?: string | undefined;
  displayOrder: number;
  actorUserId?: string | undefined;
};

export type UpdatePincodeInput = Partial<Omit<CreatePincodeInput, 'pincode'>>;

export interface CityRepository {
  list(scope: BusinessScope, filter: CityListFilter): Promise<CityRow[]>;
  findById(scope: BusinessScope, id: string): Promise<CityRow | null>;
  findBySlug(scope: BusinessScope, slug: string): Promise<CityRow | null>;
  create(scope: BusinessScope, input: CreateCityInput): Promise<CityRow>;
  update(scope: BusinessScope, id: string, input: UpdateCityInput): Promise<CityRow>;
  /** Sets status and stamps activated_at. Never deletes (BR-SV6). */
  setStatus(
    scope: BusinessScope,
    id: string,
    status: ServiceabilityStatus,
    actorUserId?: string,
  ): Promise<CityRow>;
  countActivePincodes(scope: BusinessScope, cityId: string): Promise<number>;
}

export interface PincodeRepository {
  list(scope: BusinessScope, filter: PincodeListFilter): Promise<PincodeRow[]>;
  findById(scope: BusinessScope, id: string): Promise<PincodeRow | null>;
  findByPincode(scope: BusinessScope, pincode: string): Promise<PincodeRow | null>;
  create(scope: BusinessScope, input: CreatePincodeInput): Promise<PincodeRow>;
  update(scope: BusinessScope, id: string, input: UpdatePincodeInput): Promise<PincodeRow>;
  setStatus(
    scope: BusinessScope,
    id: string,
    status: ServiceabilityStatus,
    actorUserId?: string,
  ): Promise<PincodeRow>;
}
