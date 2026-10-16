import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

/**
 * Status chips. The semantic variants map onto the brand's status set: default = completed/positive (green),
 * secondary = in progress (blue), warning = late/partial/rework (amber), destructive = missed/failed/critical (red),
 * audit = audit pending/in progress (violet), outline = neutral/inactive. Text is always present, colour never alone.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: 'bg-status-ok-soft text-status-ok-text [a]:hover:bg-status-ok-soft/70',
        secondary: 'bg-status-active-soft text-status-active-text [a]:hover:bg-status-active-soft/70',
        warning: 'bg-status-late-soft text-status-late-text [a]:hover:bg-status-late-soft/70',
        destructive: 'bg-status-bad-soft text-status-bad-text [a]:hover:bg-status-bad-soft/70',
        audit: 'bg-status-audit-soft text-status-audit-text [a]:hover:bg-status-audit-soft/70',
        outline: 'border-border text-muted-foreground [a]:hover:bg-muted',
        ghost: 'hover:bg-muted hover:text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({ className, variant = 'default', asChild = false, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
