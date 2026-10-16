'use client';

import type { AdminUnitDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  DataTable,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  ResponsiveContainer,
  Select,
  type DataTableColumn,
} from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

const DIMENSION_OPTIONS = [
  { value: 'MASS', label: 'Mass' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'COUNT', label: 'Count' },
];

function CreateUnitForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [symbol, setSymbol] = useState('');
  const [dimension, setDimension] = useState('MASS');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.createUnit({
        code: code.trim(),
        label: label.trim(),
        symbol: symbol.trim(),
        dimension: dimension as 'MASS' | 'VOLUME' | 'COUNT',
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'UNIT_CODE_TAKEN'
          ? 'A unit with this code already exists.'
          : err instanceof ApiError
            ? err.message
            : 'Could not create this unit.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <FieldLabel htmlFor="unit-code">Code</FieldLabel>
        <Input
          id="unit-code"
          required
          placeholder="e.g. oz"
          className="mt-1"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="unit-label">Label</FieldLabel>
        <Input
          id="unit-label"
          required
          placeholder="e.g. Ounces (oz)"
          className="mt-1"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="unit-symbol">Symbol</FieldLabel>
        <Input
          id="unit-symbol"
          required
          placeholder="e.g. oz"
          className="mt-1"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="unit-dimension">Dimension</FieldLabel>
        <Select
          id="unit-dimension"
          className="mt-1"
          value={dimension}
          options={DIMENSION_OPTIONS}
          onChange={(e) => setDimension(e.target.value)}
        />
      </div>
      <div className="col-span-full flex items-center gap-3">
        <FieldError>{error}</FieldError>
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          Create unit
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function UnitsSettingsPage() {
  const [units, setUnits] = useState<AdminUnitDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await apiClient.listUnits();
      setUnits(result.data);
    } catch {
      setError('Could not load units.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleActive(unit: AdminUnitDto) {
    setActionError(null);
    try {
      await apiClient.updateUnit(unit.id, { is_active: !unit.is_active });
      void load();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === 'UNIT_IN_USE'
          ? err.message
          : err instanceof ApiError
            ? err.message
            : 'Could not update this unit.',
      );
    }
  }

  const columns: DataTableColumn<AdminUnitDto>[] = [
    {
      key: 'unit',
      header: 'Unit',
      render: (unit) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sand-900 font-semibold">{unit.label}</p>
            {!unit.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
          </div>
          <p className="text-caption text-sand-600 mt-0.5">
            code: {unit.code} · symbol: {unit.symbol}
          </p>
        </div>
      ),
    },
    {
      key: 'dimension',
      header: 'Dimension',
      render: (unit) => <Badge tone="neutral">{unit.dimension}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (unit) => (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => void toggleActive(unit)}>
            {unit.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <PageHeader
          title="Units of measurement"
          description="Used by product variant forms across the catalogue. A unit already assigned to a variant keeps displaying correctly even if later deactivated."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Units' }]}
          action={
            !showCreate ? (
              <Button onClick={() => setShowCreate(true)}>New unit</Button>
            ) : undefined
          }
        />

        {showCreate ? (
          <Card className="mt-5 p-5">
            <h2 className="text-heading-sm text-sand-900">New unit</h2>
            <div className="mt-4">
              <CreateUnitForm
                onCancel={() => setShowCreate(false)}
                onSaved={() => {
                  setShowCreate(false);
                  void load();
                }}
              />
            </div>
          </Card>
        ) : null}

        {actionError ? <p className="text-body-sm text-danger-600 mt-4">{actionError}</p> : null}

        <div className="mt-6">
          <DataTable
            columns={columns}
            data={units}
            rowKey={(unit) => unit.id}
            error={error}
            onRetry={() => void load()}
            emptyTitle="No units yet"
            emptyDescription="Create one to use it in product variant forms."
          />
        </div>

        <p className="text-caption text-sand-500 mt-6">
          <Link href="/settings" className="text-green-700 hover:underline">
            ← Back to Settings
          </Link>
        </p>
      </ResponsiveContainer>
    </main>
  );
}
