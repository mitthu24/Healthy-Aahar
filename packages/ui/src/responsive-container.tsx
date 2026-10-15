import { type ReactNode } from 'react';

import { cn } from './cn.js';

/** Consistent page-content max-width and horizontal gutter, used by every admin page. */
export function ResponsiveContainer({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** Wider cap for data-dense pages (tables, dashboard grids) vs. forms. */
  wide?: boolean;
}) {
  return (
    <div className={cn('mx-auto w-full px-4 sm:px-6', wide ? 'max-w-6xl' : 'max-w-4xl', className)}>
      {children}
    </div>
  );
}
