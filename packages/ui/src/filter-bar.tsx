import { type ReactNode } from 'react';

import { cn } from './cn.js';

/** Horizontal row of filter controls that wraps and scrolls cleanly on narrow screens instead of clipping. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)} role="group">
      {children}
    </div>
  );
}
