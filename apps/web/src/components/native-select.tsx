import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A styled native <select>: accessible, testable and form-friendly without a popover. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
