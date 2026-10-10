import { type HTMLAttributes } from 'react';

import { cn } from './cn.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-sand-0 border-sand-200 rounded-lg border shadow-sm', className)}
      {...props}
    />
  );
}
