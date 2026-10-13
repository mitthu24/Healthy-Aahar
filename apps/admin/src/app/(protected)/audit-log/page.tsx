'use client';

import type { AuditLogEntry } from '@healthy-aahar/sdk';
import { Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@healthy-aahar/ui';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

function formatMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return Object.entries(metadata)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  async function load(reset: boolean) {
    setError(null);
    try {
      const result = await apiClient.listAuditLog({
        action: action || undefined,
        cursor: reset ? undefined : (nextCursor ?? undefined),
      });
      setEntries((prev) => (reset || !prev ? result.data : [...prev, ...result.data]));
      setNextCursor(result.pagination.next_cursor);
    } catch {
      setError('Could not load the audit log.');
    }
  }

  useEffect(() => {
    const id = setTimeout(() => void load(true), 250);
    return () => clearTimeout(id);
    // Intentionally only [action] — this effect debounces the action filter
    // and must not re-run on every nextCursor/entries update `load` closes
    // over.
  }, [action]);

  if (error) return <ErrorState message={error} onRetry={() => void load(true)} />;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 pb-16">
      <h1 className="font-display text-heading-lg text-sand-900">Audit log</h1>
      <p className="text-body-sm text-sand-600 mt-1">
        Every administrative change: employee, role, product, order, and settings events.
      </p>

      <div className="mt-4 max-w-xs">
        <Input
          placeholder="Filter by action (e.g. admin_user.deactivated)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
        />
      </div>

      <div className="mt-6 space-y-2">
        {entries === null ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : entries.length === 0 ? (
          <EmptyState title="No audit entries found" description="Nothing matches this filter." />
        ) : (
          entries.map((entry) => (
            <Card key={entry.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-body-sm text-sand-900 font-mono font-semibold">{entry.action}</p>
                <p className="text-caption text-sand-500">
                  {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
              <p className="text-caption text-sand-600 mt-1">
                {entry.actor_email ?? (entry.actor_type === 'SYSTEM' ? 'System' : 'Unknown actor')}
                {' · '}
                {entry.resource_type}
                {entry.resource_id ? ` #${entry.resource_id.slice(0, 8)}` : ''}
              </p>
              {formatMetadata(entry.metadata) ? (
                <p className="text-caption text-sand-500 mt-1 break-all">
                  {formatMetadata(entry.metadata)}
                </p>
              ) : null}
            </Card>
          ))
        )}
      </div>

      {nextCursor ? (
        <div className="mt-4">
          <Button
            size="sm"
            variant="secondary"
            isLoading={isLoadingMore}
            onClick={async () => {
              setIsLoadingMore(true);
              await load(false);
              setIsLoadingMore(false);
            }}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </main>
  );
}
