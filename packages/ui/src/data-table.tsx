import { type ReactNode } from 'react';

import { cn } from './cn.js';
import { EmptyState, ErrorState, Skeleton } from './skeleton.js';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  /** Hidden in the mobile card view (e.g. a column already shown as the card title). */
  hideOnMobile?: boolean;
};

export type SortDirection = 'asc' | 'desc';

/**
 * A table on desktop, stacked cards on mobile — the same `columns`/`data`
 * drive both, so there is never a separate mobile view to fall out of sync.
 * Desktop never gets page-wide horizontal scroll: columns that don't fit
 * belong in the mobile card body, not squeezed into the table.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  isLoading,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  sortKey,
  sortDirection,
  onSort,
  onRowClick,
  className,
}: {
  columns: DataTableColumn<T>[];
  data: T[] | null;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  sortKey?: string;
  sortDirection?: SortDirection;
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  if (isLoading || data === null) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={className}>
      {/* Desktop/tablet: real table, no horizontal scroll by design. */}
      <table className="hidden w-full sm:table">
        <thead>
          <tr className="border-sand-200 border-b">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'text-caption text-sand-500 px-3 py-2.5 font-semibold uppercase tracking-wide',
                  col.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {col.sortable && onSort ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className="hover:text-sand-700 inline-flex items-center gap-1"
                  >
                    {col.header}
                    {sortKey === col.key ? (
                      <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    ) : null}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-sand-100 border-b last:border-0',
                onRowClick && 'hover:bg-sand-50 cursor-pointer',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'text-body-sm text-sand-800 px-3 py-3',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards — never a cramped, clipped table. */}
      <ul className="space-y-3 sm:hidden">
        {data.map((row) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'border-sand-200 bg-sand-0 rounded-lg border p-4',
              onRowClick && 'active:bg-sand-50 cursor-pointer',
            )}
          >
            <dl className="space-y-1.5">
              {columns
                .filter((col) => !col.hideOnMobile)
                .map((col) => (
                  <div key={col.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-caption text-sand-500 shrink-0">{col.header}</dt>
                    <dd className="text-body-sm text-sand-800 text-right">{col.render(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
