import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  SettingRepository,
  UnitInput,
  UnitRepository,
  UnitRow,
  UnitUpdateInput,
} from '../ports/settings-repository.js';

export type AdminSettingsServiceDeps = {
  units: UnitRepository;
  settings: SettingRepository;
  audit: AuditLogRepository;
};

/** Key for the configurable GST/tax-rate ceiling (docs: Stage F) — replaces
 *  the previously hardcoded 10,000bps (100%) upper bound on a variant's
 *  `tax_rate_bps` with a per-business value, defaulting to 2800 (28%, the
 *  real top GST slab) when no row exists yet (a fresh business that hasn't
 *  opened Settings once). */
const MAX_TAX_RATE_SETTING_KEY = 'catalog.max_tax_rate_bps';
const DEFAULT_MAX_TAX_RATE_BPS = 2800;

/**
 * Stage F — catalogue settings: database-backed units (replacing the
 * hardcoded `UNIT_CATALOG`) and the configurable tax-rate ceiling. Every
 * write is audited, matching the convention every other admin service in
 * this codebase already follows.
 */
export class AdminSettingsService {
  private readonly units: UnitRepository;
  private readonly settings: SettingRepository;
  private readonly audit: AuditLogRepository;

  constructor(deps: AdminSettingsServiceDeps) {
    this.units = deps.units;
    this.settings = deps.settings;
    this.audit = deps.audit;
  }

  async listUnits(scope: BusinessScope, filter?: { activeOnly?: boolean }): Promise<UnitRow[]> {
    return this.units.list(scope, filter);
  }

  async createUnit(scope: BusinessScope, input: UnitInput, actorUserId: string): Promise<UnitRow> {
    const existing = await this.units.findByCode(scope, input.code);
    if (existing) {
      throw new DomainError('UNIT_CODE_TAKEN', 'A unit with this code already exists.');
    }

    const created = await this.units.create(scope, input);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'unit.created',
      resourceType: 'unit',
      resourceId: created.id,
      metadata: { code: created.code, label: created.label, dimension: created.dimension },
    });

    return created;
  }

  async updateUnit(
    scope: BusinessScope,
    id: string,
    input: UnitUpdateInput,
    actorUserId: string,
  ): Promise<UnitRow> {
    const existing = await this.getUnitOrThrow(scope, id);

    // Deactivating a unit that is still in use would leave existing
    // variants pointing at a code no longer selectable for NEW variants —
    // fine (they keep displaying their already-assigned unit unchanged) —
    // but would also hide it from the dropdown for an admin trying to edit
    // one of those same variants' OTHER fields, with no way to re-select
    // it. Refusing outright is simpler and safer than teaching every
    // variant form to special-case "selected but inactive."
    if (input.isActive === false && existing.isActive) {
      const referenceCount = await this.units.countVariantReferences(scope, existing.code);
      if (referenceCount > 0) {
        throw new DomainError(
          'UNIT_IN_USE',
          `This unit is used by ${referenceCount} product variant(s) and cannot be deactivated.`,
        );
      }
    }

    const updated = await this.units.update(scope, id, input);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'unit.updated',
      resourceType: 'unit',
      resourceId: id,
      metadata: { ...input },
    });

    return updated;
  }

  private async getUnitOrThrow(scope: BusinessScope, id: string): Promise<UnitRow> {
    const unit = await this.units.findById(scope, id);
    if (!unit) throw new DomainError('UNIT_NOT_FOUND', 'Unit not found.');
    return unit;
  }

  /** Validates a variant's `unit` code against this business's own active
   *  units — called by `AdminCatalogueService` on variant create/update, so
   *  a retired or unknown code can never be assigned to a new/edited
   *  variant while an already-assigned one keeps displaying unchanged. */
  async assertUnitIsActive(scope: BusinessScope, code: string): Promise<void> {
    const unit = await this.units.findByCode(scope, code);
    if (!unit || !unit.isActive) {
      throw new DomainError(
        'INVALID_UNIT',
        `"${code}" is not a configured, active unit for this business.`,
      );
    }
  }

  async getMaxTaxRateBps(scope: BusinessScope): Promise<number> {
    const value = await this.settings.getValue(scope, MAX_TAX_RATE_SETTING_KEY);
    return typeof value === 'number' ? value : DEFAULT_MAX_TAX_RATE_BPS;
  }

  async setMaxTaxRateBps(scope: BusinessScope, bps: number, actorUserId: string): Promise<number> {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'The tax-rate ceiling must be a whole number of basis points between 0 and 10000 (0–100%).',
      );
    }

    await this.settings.setValue(scope, MAX_TAX_RATE_SETTING_KEY, bps, actorUserId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'settings.tax_rate_ceiling_changed',
      resourceType: 'setting',
      // No resourceId: this setting's key ('catalog.max_tax_rate_bps') is
      // not a UUID, and resource_id is a uuid column — the key lives in
      // metadata instead.
      metadata: { key: MAX_TAX_RATE_SETTING_KEY, max_tax_rate_bps: bps },
    });

    return bps;
  }
}
