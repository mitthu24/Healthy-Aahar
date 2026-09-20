import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-green-600 text-sand-0 hover:bg-green-700 active:bg-green-800',
  secondary: 'bg-sand-0 text-sand-800 border border-sand-200 hover:bg-sand-50',
  ghost: 'bg-transparent text-green-600 hover:bg-green-50',
  danger: 'bg-danger-600 text-sand-0 hover:opacity-90',
};

// Mobile primary actions use `lg`. Every size meets the 44px minimum touch
// target except `sm`, which is desktop-only by convention (docs/14 §6).
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-body-sm',
  md: 'h-11 px-4 text-body-md',
  lg: 'h-13 px-6 text-body-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', isLoading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'duration-quick transition-colors ease-out',
        // Focus rings are never removed. An invisible focus state is a bug,
        // not a style choice (docs/17 §5).
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
