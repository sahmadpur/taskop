import { MARK_CHECK, MARK_RING, MARK_VIEWBOX } from '@taskop/brand';
import { cn } from '@/lib/utils';

/** The Taskop mark: a ring with a check breaking out of it. Inherits `currentColor`. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={cn('size-6 shrink-0', className)} aria-hidden focusable="false">
      <path d={MARK_RING} fill="none" stroke="currentColor" strokeWidth={7} strokeLinecap="round" />
      <path d={MARK_CHECK} fill="none" stroke="currentColor" strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The wordmark: mark plus "Taskop". `tone` picks the mark colour; the text follows the parent's colour. */
export function Logo({ className = '', tone = 'brand' }: { className?: string; tone?: 'brand' | 'inherit' }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]', className)}>
      <Mark className={cn('size-7', tone === 'brand' && 'text-primary')} />
      Taskop
    </span>
  );
}
