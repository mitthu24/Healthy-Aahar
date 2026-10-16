import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Stage F — database-backed catalogue settings (units, and the configurable
 * tax-rate ceiling). Business-scoped like every other catalogue entity in
 * this codebase.
 */

export type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT';

export type UnitRow = {
  id: string;
  businessId: string;
  code: string;
  label: string;
  symbol: string;
  dimension: UnitDimension;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UnitInput = {
  code: string;
  label: string;
  symbol: string;
  dimension: UnitDimension;
};

export type UnitUpdateInput = Partial<{
  label: string;
  symbol: string;
  isActive: boolean;
}>;

export interface UnitRepository {
  list(scope: BusinessScope, filter?: { activeOnly?: boolean }): Promise<UnitRow[]>;
  findById(scope: BusinessScope, id: string): Promise<UnitRow | null>;
  findByCode(scope: BusinessScope, code: string): Promise<UnitRow | null>;
  create(scope: BusinessScope, input: UnitInput): Promise<UnitRow>;
  update(scope: BusinessScope, id: string, input: UnitUpdateInput): Promise<UnitRow>;
  /** Count of product_variants currently using this unit's code, for this
   *  business — the caller refuses to deactivate a unit still in use. */
  countVariantReferences(scope: BusinessScope, code: string): Promise<number>;
}

/** The generic `Setting` table (already seeded, previously unexposed to any
 *  admin UI) — only the whitelisted catalogue-relevant keys this service
 *  actually reads/writes are modelled here, not a general key-value editor. */
export interface SettingRepository {
  getValue(scope: BusinessScope, key: string): Promise<unknown | null>;
  setValue(scope: BusinessScope, key: string, value: unknown, updatedBy: string): Promise<void>;
}
