import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from './cn.js';

export type SelectOption = { value: string; label: string };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: SelectOption[];
  placeholder?: string;
};

/** Native `<select>` — works with screen readers, mobile pickers and keyboard navigation for free. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'border-sand-200 bg-sand-0 text-body-md text-sand-800 h-11 w-full rounded-md border px-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {placeholder ? (
        <option value="" disabled={props.required}>
          {placeholder}
        </option>
      ) : null}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
});
