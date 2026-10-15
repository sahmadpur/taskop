import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type AuditDetail } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmailListInput } from '@/components/email-list-input';
import { FormError } from '@/components/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { saveFile } from '@/features/reports/download';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { api, useCan } from '@/lib/session';
import { auditKeys } from './queries';

/**
 * A finished audit's PDF (spec §7.2, §8.3): its status, who it went to, the download, and Retry (failed) or Resend
 * (ready) for audits.perform holders. `timedOut`: the 60 s polling window ran out while the report was pending.
 */
export function ReportPanel({ audit, timedOut, onRestart }: { audit: AuditDetail; timedOut: boolean; onRestart: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canPerform = useCan('audits.perform');
  const formatDateTime = useFormatDateTime();
  const [resending, setResending] = useState(false);
  /** A new polling window, and the audit asked again now. */
  const refresh = () => {
    onRestart();
    void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
  };
  const download = useMutation({
    mutationFn: () => api.audits.downloadReport(audit.id),
    onSuccess: (file) => saveFile(file),
    onError: (e) => (e instanceof ApiError && e.code === 'REPORT_NOT_READY' ? refresh() : toast.error(errorText(t, e))),
  });
  const retry = useMutation({
    mutationFn: () => api.audits.sendReport(audit.id),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(t, e)),
  });
  const s = audit.reportStatus;

  return (
    <section aria-labelledby="audit-report-title" className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="audit-report-title" className="font-semibold">
          {t('audits.web.report.title')}
        </h2>
        <Badge variant={s === 'failed' ? 'destructive' : s === 'ready' ? 'default' : 'secondary'}>{t(`audits.reportStatuses.${s}`)}</Badge>
      </div>
      {s === 'pending' && !timedOut && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('audits.web.report.preparing')}
        </p>
      )}
      {s === 'pending' && timedOut && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-muted-foreground text-sm">
            {t('audits.web.report.slow')}
          </p>
          <Button size="sm" variant="outline" onClick={refresh}>
            {t('audits.web.report.checkAgain')}
          </Button>
        </div>
      )}
      {s === 'failed' && <p className="text-destructive text-sm">{t('audits.web.report.failed')}</p>}
      <dl className="grid gap-1 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">{t('audits.fields.recipients')}</dt>
          <dd>{audit.reportRecipients.length > 0 ? audit.reportRecipients.join(', ') : t('audits.web.report.noRecipients')}</dd>
        </div>
        {audit.reportSentAt && (
          <div>
            <dt className="text-muted-foreground text-xs">{t('audits.fields.sentAt')}</dt>
            <dd>{formatDateTime(audit.reportSentAt)}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button disabled={s !== 'ready' || download.isPending} onClick={() => download.mutate()}>
          <Download className="size-4" aria-hidden />
          {t('audits.actions.downloadReport')}
        </Button>
        {canPerform && s === 'failed' && (
          <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {t('audits.actions.retryReport')}
          </Button>
        )}
        {canPerform && s === 'ready' && (
          <Button variant="outline" onClick={() => setResending(true)}>
            {t('audits.actions.resendReport')}
          </Button>
        )}
      </div>
      {resending && <ResendDialog audit={audit} onClose={() => setResending(false)} onSent={refresh} />}
    </section>
  );
}

function ResendDialog({ audit, onClose, onSent }: { audit: AuditDetail; onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<string[]>(audit.reportRecipients);
  const send = useMutation({
    mutationFn: () => api.audits.sendReport(audit.id, { emails }),
    onSuccess: () => {
      toast.success(t('audits.web.report.sent'));
      onSent();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('audits.web.report.resendTitle')}</DialogTitle>
        </DialogHeader>
        <EmailListInput id="resend-emails" label={t('audits.fields.recipients')} value={emails} onChange={setEmails} max={AUDIT_LIMITS.recipients} />
        <FormError message={send.error ? errorText(t, send.error) : null} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={emails.length === 0 || send.isPending} onClick={() => send.mutate()}>
            {t('audits.web.report.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
