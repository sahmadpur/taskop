import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A styled native <select>: accessible, testable and form-friendly without a popover. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input focus-visible:ring-ring h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
