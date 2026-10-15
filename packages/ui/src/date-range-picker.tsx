'use client';

import { cn } from './cn.js';
import { Select } from './select.js';

export type DateRangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'custom';

export type DateRange = { from: string; to: string };

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

/** `YYYY-MM-DD` for a UTC instant — a reasonable client-side default only;
 *  the server is the sole source of truth for business-date boundaries
 *  (`businessDateTimeToUtc`, Asia/Kolkata) and re-validates every request. */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a preset into a concrete `{from, to}` pair, relative to `now`
 * (pass the caller's own clock read — never a bare `new Date()` inside this
 * shared package). Shared by every page that uses `DateRangePicker`, so a
 * preset (e.g. "Yesterday") can never be offered in the dropdown without
 * also being resolved correctly everywhere it's used.
 */
export function rangeForPreset(preset: DateRangePreset, now: Date): DateRange {
  const today = toDateString(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const value = toDateString(yesterday);
    return { from: value, to: value };
  }
  if (preset === '7d') {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: toDateString(from), to: today };
  }
  if (preset === '30d') {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: toDateString(from), to: today };
  }
  if (preset === 'this_month') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: toDateString(from), to: today };
  }
  return { from: today, to: today };
}

/**
 * Preset dropdown plus two native date inputs (shown only for "Custom
 * range"). Native `<input type="date">` is used deliberately — it's
 * accessible and usable on mobile without a bundled calendar widget.
 */
export function DateRangePicker({
  preset,
  range,
  onPresetChange,
  onRangeChange,
  className,
}: {
  preset: DateRangePreset;
  range: DateRange;
  onPresetChange: (preset: DateRangePreset) => void;
  onRangeChange: (range: DateRange) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Select
        aria-label="Date range"
        className="w-auto min-w-[9rem]"
        value={preset}
        options={PRESETS}
        onChange={(e) => onPresetChange(e.target.value as DateRangePreset)}
      />
      {preset === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="From date"
            value={range.from}
            onChange={(e) => onRangeChange({ ...range, from: e.target.value })}
            className="border-sand-200 bg-sand-0 text-body-sm h-11 rounded-md border px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          />
          <span className="text-sand-400" aria-hidden="true">
            –
          </span>
          <input
            type="date"
            aria-label="To date"
            value={range.to}
            onChange={(e) => onRangeChange({ ...range, to: e.target.value })}
            className="border-sand-200 bg-sand-0 text-body-sm h-11 rounded-md border px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          />
        </div>
      ) : null}
    </div>
  );
}
