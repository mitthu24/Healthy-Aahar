import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './cn.js';

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="m17 17-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

export const SearchInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label?: string }
>(function SearchInput({ className, label = 'Search', ...props }, ref) {
  return (
    <div className={cn('relative', className)}>
      <span className="text-sand-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
        <SearchIcon />
      </span>
      <input
        ref={ref}
        type="search"
        aria-label={label}
        className={cn(
          'border-sand-200 bg-sand-0 text-body-md text-sand-800 placeholder:text-sand-400',
          'h-11 w-full rounded-md border py-2 pl-9 pr-3',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600',
        )}
        {...props}
      />
    </div>
  );
});
