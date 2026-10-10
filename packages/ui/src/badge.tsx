import { type HTMLAttributes } from 'react';

import { cn } from './cn.js';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-sand-100 text-sand-800',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
  info: 'bg-info-50 text-info-600',
  brand: 'bg-green-50 text-green-600',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'text-caption inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Order-status -> badge tone, shared so every screen colours a status identically. */
export function orderStatusTone(displayStatus: string): BadgeTone {
  switch (displayStatus) {
    case 'Delivered':
    case 'Confirmed':
      return 'success';
    case 'Cancelled':
    case 'Rejected':
    case 'Delivery attempt failed':
      return 'danger';
    case 'Awaiting confirmation':
    case 'Preparing':
      return 'warning';
    case 'Dispatched':
      return 'info';
    default:
      return 'neutral';
  }
}
