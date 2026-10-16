/**
 * Catalogue unit of measure (Stage E).
 *
 * `ProductVariant.unit`/`unitValue` already existed as a free-text string +
 * decimal quantity; nothing validated `unit` against anything. This is the
 * one shared, configurable list every layer reads from — the admin UI's
 * `<Select>` and `unitCodeSchema` below both import `UNIT_CATALOG` rather
 * than hardcoding the list a second time anywhere. Lives in `contracts`
 * (not `core`) because `core` already depends on `contracts`, not the
 * reverse, and both the Zod schema here and the admin UI need this list.
 *
 * `dimension` exists so a mass unit and a volume unit are never silently
 * treated as interchangeable (e.g. summing "500 g" and "1 L" as if they
 * were the same kind of quantity). No conversion function is implemented
 * here, deliberately: nothing in this codebase currently needs to convert
 * between dimensions, and inventing one without a real, product-specific
 * conversion factor would be exactly the silent-interchange this is meant
 * to prevent.
 */
import { z } from 'zod';

export type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT';

export type UnitDefinition = {
  code: string;
  label: string;
  dimension: UnitDimension;
};

export const UNIT_CATALOG: readonly UnitDefinition[] = [
  { code: 'g', label: 'Grams (g)', dimension: 'MASS' },
  { code: 'kg', label: 'Kilograms (kg)', dimension: 'MASS' },
  { code: 'ml', label: 'Millilitres (ml)', dimension: 'VOLUME' },
  { code: 'L', label: 'Litres (L)', dimension: 'VOLUME' },
  { code: 'piece', label: 'Piece', dimension: 'COUNT' },
  { code: 'pack', label: 'Pack', dimension: 'COUNT' },
];

export const UNIT_CODES = UNIT_CATALOG.map((u) => u.code) as [string, ...string[]];

export function isValidUnit(code: string): boolean {
  return UNIT_CATALOG.some((u) => u.code === code);
}

export function unitDimension(code: string): UnitDimension | null {
  return UNIT_CATALOG.find((u) => u.code === code)?.dimension ?? null;
}

export const unitCodeSchema = z.enum(UNIT_CODES);
