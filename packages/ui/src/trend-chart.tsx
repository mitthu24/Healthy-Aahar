import { useId, useState } from 'react';

import { cn } from './cn.js';

export type TrendChartPoint = { label: string; value: number; valueLabel: string };

/**
 * A minimal, dependency-free SVG bar chart (Stage D) — no charting library
 * was added; for a bounded number of points (a date-range trend, never an
 * unbounded series) a hand-rolled chart is simpler and lighter than a new
 * dependency. Readable on hover/focus via a native tooltip-like label
 * (not the browser's default `<title>` delay) and exposed to screen
 * readers through a visually-hidden data table, not just the SVG shapes.
 */
export function TrendChart({
  points,
  className,
  height = 160,
}: {
  points: TrendChartPoint[];
  className?: string;
  height?: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const titleId = useId();

  if (points.length === 0) {
    return (
      <div
        className={cn(
          'border-sand-200 text-sand-500 text-body-sm flex items-center justify-center rounded-md border border-dashed',
          className,
        )}
        style={{ height }}
      >
        No data in this range.
      </div>
    );
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const barWidth = 100 / points.length;
  const active = activeIndex !== null ? points[activeIndex] : null;

  return (
    <div className={cn('relative', className)}>
      <table className="sr-only">
        <caption>Sales trend by day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{p.valueLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {active ? (
        <div
          id={titleId}
          role="status"
          className="text-caption text-sand-700 bg-sand-900/5 absolute right-0 top-0 rounded-md px-2 py-1 font-medium"
        >
          {active.label}: {active.valueLabel}
        </div>
      ) : null}

      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        aria-hidden="true"
      >
        {points.map((p, i) => {
          const barHeight = max > 0 ? (p.value / max) * (height - 4) : 0;
          return (
            <rect
              key={p.label}
              x={i * barWidth + barWidth * 0.15}
              y={height - barHeight}
              width={barWidth * 0.7}
              height={barHeight}
              rx={1}
              className={cn(
                'cursor-pointer transition-colors',
                activeIndex === i ? 'fill-green-600' : 'fill-green-200 hover:fill-green-400',
              )}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
              tabIndex={0}
            />
          );
        })}
      </svg>

      <div className="text-caption text-sand-500 mt-1 flex justify-between">
        <span>{points[0]?.label}</span>
        {points.length > 1 ? <span>{points[points.length - 1]?.label}</span> : null}
      </div>
    </div>
  );
}
