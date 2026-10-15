import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, AUDIT_RESULTS, type AuditDetail, type AuditResult, type FinishAuditInput, reportRecipients } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmailListInput } from '@/components/email-list-input';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { auditKeys } from './queries';

/**
 * Cancel and Finish for an audit in progress (decisions 7 and 8). With unreviewed items Finish points at them instead
 * of opening the dialog; while the run is with the worker it is disabled and the paused banner says why.
 */
export function AuditActions({ audit, missing, onIncomplete }: { audit: AuditDetail; missing: readonly string[]; onIncomplete: (itemIds: readonly string[]) => void }) {
  const { t } = useTranslation();
  const canPerform = useCan('audits.perform');
  const [dialog, setDialog] = useState<null | 'finish' | 'cancel'>(null);
  if (!canPerform || audit.status !== 'in_progress') return null;
  return (
    <>
      <Button variant="outline" onClick={() => setDialog('cancel')}>
        {t('audits.actions.cancel')}
      </Button>
      <Button disabled={audit.paused} onClick={() => (missing.length > 0 ? onIncomplete(missing) : setDialog('finish'))}>
        {t('audits.actions.finish')}
      </Button>
      {dialog === 'finish' && <FinishDialog audit={audit} onClose={() => setDialog(null)} onIncomplete={onIncomplete} />}
      {dialog === 'cancel' && <CancelAuditDialog audit={audit} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Refusals that mean the audit changed under the auditor; every other refusal leaves the dialog and its fields as they are. */
const STALE: ReadonlySet<string> = new Set(['AUDIT_PAUSED', 'AUDIT_NOT_IN_PROGRESS', 'AUDIT_INCOMPLETE']);

function FinishDialog({ audit, onClose, onIncomplete }: { audit: AuditDetail; onClose: () => void; onIncomplete: (itemIds: readonly string[]) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [result, setResult] = useState<AuditResult | null>(null);
  const [comment, setComment] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const finish = useMutation({
    mutationFn: (body: FinishAuditInput) => api.audits.finish(audit.id, body),
    onSuccess: async () => {
      toast.success(t('audits.web.finish.done'));
      onClose();
      await refreshRunViews(qc);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'AUDIT_INCOMPLETE') {
        onClose();
        onIncomplete(e.itemIds ?? []);
        void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
        return;
      }
      setError(errorText(t, e));
      // A stale refusal (the run was sent back or the audit ended meanwhile): the dialog says why, and the audit is reloaded.
      if (e instanceof ApiError && STALE.has(e.code)) void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
    },
  });
  /** R23: the server refuses a merged list (checklist addresses plus extras, de-duplicated) over the limit; so do we. */
  const submit = () => {
    if (!result) return;
    if (reportRecipients(audit.checklistReportEmails, extra).length > AUDIT_LIMITS.recipients) {
      setError(t('audits.issues.tooManyEmails'));
      return;
    }
    setError(null);
    finish.mutate({ result, comment: comment.trim() || null, extraEmails: extra });
  };
  const reviewed = audit.verdicts.filter((v) => audit.auditableItemIds.includes(v.itemId)).length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('audits.web.finish.title')}</DialogTitle>
          <DialogDescription>{t('audits.progress', { reviewed, total: audit.auditableItemIds.length })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('audits.fields.result')}</legend>
            {AUDIT_RESULTS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="radio" name="audit-result" value={r} checked={result === r} onChange={() => setResult(r)} />
                {t(`audits.results.${r}`)}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="finish-comment">{t('audits.fields.comment')}</Label>
            <Textarea id="finish-comment" maxLength={AUDIT_LIMITS.finalComment} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-medium">{t('audits.web.finish.checklistEmails')}</p>
            {audit.checklistReportEmails.length > 0 ? (
              <ul className="text-sm">
                {audit.checklistReportEmails.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('audits.web.finish.noChecklistEmails')}</p>
            )}
          </div>
          <EmailListInput
            id="finish-extra-emails"
            label={t('audits.fields.extraEmails')}
            value={extra}
            onChange={setExtra}
            max={AUDIT_LIMITS.recipients}
          />
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={result === null || finish.isPending} onClick={submit}>
            {t('audits.web.finish.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelAuditDialog({ audit, onClose }: { audit: AuditDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.audits.cancel(audit.id, { reason: reason.trim() }),
    onSuccess: async () => {
      toast.success(t('audits.web.cancel.done'));
      onClose();
      await refreshRunViews(qc);
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('audits.web.cancel.title')}</DialogTitle>
          <DialogDescription>{t('audits.web.cancel.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-audit-reason">{t('audits.fields.cancelReason')}</Label>
          <Textarea id="cancel-audit-reason" maxLength={AUDIT_LIMITS.cancelReason} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <FormError message={cancel.error ? errorText(t, cancel.error) : null} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
            {t('audits.web.cancel.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
