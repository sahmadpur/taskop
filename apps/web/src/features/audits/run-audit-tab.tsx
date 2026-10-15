import { canStartAudit, type OccurrenceDetail } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatPercent } from '@/features/executions/labels';
import { useExecution } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { useCan, useMe } from '@/lib/session';
import { cn } from '@/lib/utils';
import { resultVariant } from './labels';
import { useStartAudit } from './queries';

/** The run dialog's "Audit" tab (spec §8.3): the run's audit and a link to it, or "Start audit" when the rules allow. */
export function RunAuditTab({ occurrence }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  if (!occurrence.execution) return <p className="text-muted-foreground">{t('executions.notStarted')}</p>;
  return <RunAudit occurrence={occurrence} executionId={occurrence.execution.id} />;
}

function RunAudit({ occurrence, executionId }: { occurrence: OccurrenceDetail; executionId: string }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const canPerform = useCan('audits.perform');
  const canView = useCan('reports.view');
  const detail = useExecution(executionId);
  const start = useStartAudit();
  if (detail.isError) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  if (!detail.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  const d = detail.data;
  // A cancelled audit no longer counts (Part 1 "What the UI may offer").
  const audit = d.audit && d.audit.status !== 'cancelled' ? d.audit : null;

  if (!audit) {
    const startable = canPerform && canStartAudit({ status: occurrence.status, executionState: d.state }, false);
    return (
      <div className="grid gap-3">
        <p className="text-muted-foreground">{t('audits.noAudit')}</p>
        {startable && (
          <Button className="w-fit" disabled={start.isPending} onClick={() => start.mutate(executionId, { onError: (e) => toast.error(errorText(t, e)) })}>
            {t('audits.actions.start')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(`audits.statuses.${audit.status}`)}</Badge>
        {audit.result && <Badge variant={resultVariant(audit.result)}>{t(`audits.results.${audit.result}`)}</Badge>}
        {audit.percent !== null && (
          <span className="text-sm">
            {t('audits.score')}: {t('executions.percent', { value: formatPercent(audit.percent, tenant.locale) })}
          </span>
        )}
      </div>
      {audit.paused && (
        <Alert>
          <AlertDescription>{t('audits.paused')}</AlertDescription>
        </Alert>
      )}
      {(canPerform || canView) && (
        <Link to="/audits/$auditId" params={{ auditId: audit.id }} className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
          {t('audits.actions.open')}
        </Link>
      )}
    </div>
  );
}
