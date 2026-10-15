import { type ReactNode } from 'react';

import { Card } from './card.js';
import { cn } from './cn.js';
import { Skeleton } from './skeleton.js';

export type StatTrend = 'up' | 'down' | 'flat';

const trendClasses: Record<StatTrend, string> = {
  up: 'text-success-600',
  down: 'text-danger-600',
  flat: 'text-sand-500',
};

const trendSymbol: Record<StatTrend, string> = { up: '▲', down: '▼', flat: '—' };

/**
 * A single KPI tile. `value` is the already-formatted display string (e.g.
 * "₹48,250" or "1,204") — this component does no calculation or formatting
 * of its own, so a dashboard can never silently misrepresent a number by
 * going through a second, inconsistent formatting path.
 */
export function StatCard({
  label,
  value,
  caption,
  trend,
  trendLabel,
  icon,
  isLoading,
  className,
}: {
  label: string;
  value?: string;
  caption?: string;
  trend?: StatTrend;
  trendLabel?: string;
  icon?: ReactNode;
  isLoading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">{label}</p>
        {icon ? (
          <span className="text-sand-400" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      {isLoading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <p className="font-display text-heading-md tabular text-sand-900 mt-1">{value}</p>
      )}
      {caption || trend ? (
        <div className="mt-1 flex items-center gap-1.5">
          {trend ? (
            <span className={cn('text-caption font-semibold', trendClasses[trend])}>
              {trendSymbol[trend]} {trendLabel}
            </span>
          ) : null}
          {caption ? <span className="text-caption text-sand-500">{caption}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}
