import { CircleAlert, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The three shared states of a list or a panel. Each is one block: an icon, a line that says what is (not) there,
 * and the next action. `compact` drops the icon for use inside tables and popovers.
 */
export function EmptyState({ title, description, action, icon: Icon = Inbox, compact = false, className }: { title: string; description?: ReactNode; action?: ReactNode; icon?: LucideIcon; compact?: boolean; className?: string }) {
  return (
    <div className={cn('text-muted-foreground grid justify-items-center gap-2 text-center', compact ? 'px-3 py-4' : 'rounded-xl border border-dashed px-6 py-10', className)}>
      {!compact && <Icon className="text-muted-foreground/70 size-7" aria-hidden />}
      <p className="text-foreground font-medium">{title}</p>
      {description && <p className="max-w-prose text-sm">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A loading placeholder: `rows` skeleton lines, announced once to screen readers. */
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className={cn('grid gap-2', className)}>
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="bg-muted h-9 animate-pulse rounded-md" style={{ width: `${100 - (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}

/** A failed request: the message, and a retry when the caller can offer one. */
export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn('bg-status-bad-soft text-status-bad-text flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm', className)}>
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
