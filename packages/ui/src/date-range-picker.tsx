'use client';

import { cn } from './cn.js';
import { Select } from './select.js';

export type DateRangePreset = 'today' | '7d' | '30d' | 'this_month' | 'custom';

export type DateRange = { from: string; to: string };

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

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
        <div className="flex items-center gap-2">
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
