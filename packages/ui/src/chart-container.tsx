import { type ReactNode } from 'react';

import { Card } from './card.js';
import { cn } from './cn.js';

/**
 * Styling shell for a future chart — title, optional controls slot, and a
 * fixed-height plot area. No charting library is wired in yet (Stage B is
 * the design foundation only); `children` is either real chart content from
 * a later stage, or `ChartPlaceholder` below.
 */
export function ChartContainer({
  title,
  controls,
  children,
  className,
  height = 'h-64',
}: {
  title: string;
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: string;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body-md text-sand-900 font-semibold">{title}</h3>
        {controls}
      </div>
      <div className={cn('mt-3', height)}>{children}</div>
    </Card>
  );
}

/** Honest "not built yet" filler — never a fabricated chart with invented numbers. */
export function ChartPlaceholder({ label = 'Analytics coming soon' }: { label?: string }) {
  return (
    <div className="border-sand-200 text-sand-500 text-body-sm flex h-full w-full items-center justify-center rounded-md border border-dashed text-center">
      {label}
    </div>
  );
}
