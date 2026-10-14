'use client';

import { ApiError, type DeliveryDashboardDto } from '@healthy-aahar/sdk';
import { Badge, Button, Card, ErrorState, Skeleton } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Delivery partner home dashboard (Phase 06). Every number here comes from
 * the API's own computation over this partner's real assigned orders — no
 * hardcoded or fabricated figures.
 */
export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DeliveryDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  async function load() {
    setError(null);
    try {
      setDashboard(await apiClient.deliveryMe());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your dashboard.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleDuty() {
    if (!dashboard) return;
    setIsToggling(true);
    try {
      const next = dashboard.duty_status === 'ON_DUTY' ? 'OFF_DUTY' : 'ON_DUTY';
      setDashboard(await apiClient.setDeliveryDutyStatus(next));
    } catch {
      setError('Could not update duty status.');
    } finally {
      setIsToggling(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  if (!dashboard) {
    return (
      <main className="mx-auto max-w-md px-5 py-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-28 w-full" />
        <Skeleton className="mt-4 h-40 w-full" />
      </main>
    );
  }

  const onDuty = dashboard.duty_status === 'ON_DUTY';

  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Healthy Aahar
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-1">
        Hi, {dashboard.full_name.split(' ')[0]}
      </h1>

      <Card className="mt-6 flex items-center justify-between p-5">
        <div>
          <p className="text-body-sm text-sand-800 font-semibold">Duty status</p>
          <Badge tone={onDuty ? 'success' : 'neutral'} className="mt-1">
            {onDuty ? 'On duty' : 'Off duty'}
          </Badge>
        </div>
        <Button
          variant={onDuty ? 'secondary' : 'primary'}
          isLoading={isToggling}
          onClick={() => void toggleDuty()}
        >
          {onDuty ? 'Go off duty' : 'Go on duty'}
        </Button>
      </Card>
      {!onDuty ? (
        <p className="text-caption text-sand-600 mt-2">
          You won&apos;t receive new assignments while off duty. Any delivery already assigned to
          you stays yours.
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <StatCard label="Assigned" value={dashboard.assigned_count} />
        <StatCard label="Active" value={dashboard.active_count} />
        <StatCard label="Delivered today" value={dashboard.completed_today_count} />
      </div>

      <Link href="/orders" className="mt-6 block">
        <Button className="w-full" size="lg">
          View my deliveries
        </Button>
      </Link>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3 text-center">
      <p className="font-display text-heading-md text-sand-900">{value}</p>
      <p className="text-caption text-sand-600 mt-1">{label}</p>
    </Card>
  );
}
