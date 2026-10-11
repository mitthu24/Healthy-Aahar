import type { HTMLAttributes } from 'react';

import { cn } from '@healthy-aahar/ui';

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8', className)} {...props} />
  );
}
