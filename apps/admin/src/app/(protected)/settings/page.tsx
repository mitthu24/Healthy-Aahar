'use client';

import type { CatalogueSettingsDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import {
  Button,
  Card,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  ResponsiveContainer,
} from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Stage F — Global Settings landing page. Modular by design: each module
 * (units, catalogue tax-rate ceiling, categories) is its own card/section,
 * so a future settings area is a new card here, not a redesign of this
 * page. Scoped to the current business — every value here is tenant-level
 * configuration, not platform-wide.
 */
function CatalogueTaxRateCard() {
  const [settings, setSettings] = useState<CatalogueSettingsDto | null>(null);
  const [maxTaxRatePercent, setMaxTaxRatePercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function load() {
    setError(null);
    try {
      const result = await apiClient.getCatalogueSettings();
      setSettings(result);
      setMaxTaxRatePercent((result.max_tax_rate_bps / 100).toString());
    } catch {
      setError('Could not load catalogue settings.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setIsSubmitting(true);
    try {
      const result = await apiClient.updateCatalogueSettings({
        max_tax_rate_bps: Math.round(Number(maxTaxRatePercent) * 100),
      });
      setSettings(result);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this setting.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-heading-sm text-sand-900">Catalogue tax rate</h2>
      <p className="text-body-sm text-sand-600 mt-1">
        The highest tax rate a product variant may be assigned. Affects every new or edited variant
        — existing variants above a lowered ceiling keep their current rate until next edited.
      </p>
      {settings === null && !error ? (
        <p className="text-caption text-sand-400 mt-4">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <FieldLabel htmlFor="max-tax-rate">Maximum tax rate (%)</FieldLabel>
            <Input
              id="max-tax-rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              className="mt-1 w-32"
              value={maxTaxRatePercent}
              onChange={(e) => setMaxTaxRatePercent(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" isLoading={isSubmitting}>
            Save
          </Button>
          {success ? <span className="text-caption text-success-600">Saved</span> : null}
        </form>
      )}
      <FieldError>{error}</FieldError>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <PageHeader
          title="Global Settings"
          description="Configuration for this business's catalogue. These settings apply to Healthy Aahar only, not other businesses this platform may host."
        />

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-heading-sm text-sand-900">Units of measurement</h2>
            <p className="text-body-sm text-sand-600 mt-1">
              The units available when creating or editing a product variant (g, kg, ml, L, piece,
              pack, and any you add).
            </p>
            <Link href="/settings/units" className="mt-4 inline-block">
              <Button size="sm" variant="secondary">
                Manage units
              </Button>
            </Link>
          </Card>

          <Card className="p-5">
            <h2 className="text-heading-sm text-sand-900">Categories & subcategories</h2>
            <p className="text-body-sm text-sand-600 mt-1">
              The two-level category tree products are organized into.
            </p>
            <Link href="/categories" className="mt-4 inline-block">
              <Button size="sm" variant="secondary">
                Manage categories
              </Button>
            </Link>
          </Card>

          <CatalogueTaxRateCard />
        </div>
      </ResponsiveContainer>
    </main>
  );
}
