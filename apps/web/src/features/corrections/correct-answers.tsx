import { ApiError } from '@taskop/api-client';
import { type Answer, type Answers, AUDIT_LIMITS, type ExecutionDetail, type Missing, requirements, visibleItems } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { cn } from '@/lib/utils';
import { AnswerEditor } from './answer-editor';
import { correctionChanges } from './labels';

/**
 * "Cavabları düzəlt" (spec §8.3, decision 11): the run's visible items with values-only editors, then a reason. The
 * caller keys it by `answersRev`, so a reload after ANSWERS_CONFLICT starts over from the newest answers.
 */
export function CorrectAnswers({ detail, conflict, onConflict, onDone }: { detail: ExecutionDetail; conflict: boolean; onConflict: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Answers>(detail.answers);
  const [checked, setChecked] = useState(false);
  const [serverMissing, setServerMissing] = useState<Missing[] | null>(null);
  const [asking, setAsking] = useState(false);
  const visible = useMemo(() => visibleItems(detail.content, draft), [detail.content, draft]);
  const changes = useMemo(() => correctionChanges(detail.answers, draft), [detail.answers, draft]);
  const clientMissing = useMemo(() => requirements(detail.content, draft), [detail.content, draft]);
  const missing = serverMissing ?? (checked ? clientMissing : []);
  const changed = new Set(changes.map((c) => c.itemId));

  const save = useMutation({
    mutationFn: (reason: string) => api.corrections.correct(detail.id, { answersRev: detail.answersRev, changes, reason }),
    onSuccess: () => {
      toast.success(t('corrections.web.edit.saved'));
      setAsking(false);
      onDone();
      void refreshRunViews(qc);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ANSWERS_CONFLICT') {
        setAsking(false);
        onConflict();
        void qc.invalidateQueries({ queryKey: ['executions', 'detail', detail.id] });
      } else if (e instanceof ApiError && e.code === 'REQUIREMENTS_UNMET') {
        setAsking(false);
        setServerMissing(e.missing ?? []);
      }
    },
  });
  const otherError = save.error && !(save.error instanceof ApiError && ['ANSWERS_CONFLICT', 'REQUIREMENTS_UNMET'].includes(save.error.code)) ? errorText(t, save.error) : null;

  const set = (itemId: string, next: Answer | undefined) => {
    setServerMissing(null);
    setDraft((d) => ({ ...d, [itemId]: next }));
  };
  const trySave = () => {
    setChecked(true);
    setServerMissing(null);
    if (clientMissing.length === 0) setAsking(true);
  };

  return (
    <section aria-label={t('corrections.actions.correct')} className="grid gap-3">
      <Alert>
        <AlertDescription>{t('corrections.web.edit.banner')}</AlertDescription>
      </Alert>
      {conflict && (
        <Alert variant="destructive">
          <AlertDescription>{t('corrections.web.edit.conflict')}</AlertDescription>
        </Alert>
      )}
      {missing.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{t('corrections.web.edit.requirements')}</AlertDescription>
        </Alert>
      )}
      {detail.content.sections.map((s) => {
        const rows = visible.filter((v) => v.sectionId === s.id);
        if (rows.length === 0) return null;
        return (
          <section key={s.id} aria-label={s.title} className="grid gap-2">
            <h4 className="font-semibold">{s.title}</h4>
            <ol className="grid gap-2">
              {rows.map((v) => (
                <li
                  key={v.item.id}
                  aria-label={v.item.label}
                  data-changed={changed.has(v.item.id) ? 'true' : undefined}
                  style={{ marginLeft: v.depth * 16 }}
                  className={cn('grid gap-1.5 rounded-md border p-2', changed.has(v.item.id) && 'border-primary bg-primary/5')}
                >
                  <span className="font-medium">{v.item.label}</span>
                  <AnswerEditor item={v.item} answer={draft[v.item.id]} onChange={(next) => set(v.item.id, next)} />
                  {missing
                    .filter((m) => m.itemId === v.item.id)
                    .map((m) => (
                      <p key={m.kind} className="text-destructive text-xs">
                        {t(`checklists.builder.preview.missingKinds.${m.kind}`)}
                      </p>
                    ))}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-muted-foreground mr-auto text-sm">
          {changes.length > 0 ? t('corrections.web.edit.changed', { count: changes.length }) : t('corrections.web.edit.noChanges')}
        </span>
        <Button variant="outline" onClick={onDone}>
          {t('corrections.web.edit.discard')}
        </Button>
        <Button disabled={changes.length === 0} onClick={trySave}>
          {t('corrections.web.edit.save')}
        </Button>
      </div>
      {asking && <ReasonDialog busy={save.isPending} error={otherError} onSubmit={(reason) => save.mutate(reason)} onClose={() => setAsking(false)} />}
    </section>
  );
}

function ReasonDialog({ busy, error, onSubmit, onClose }: { busy: boolean; error: string | null; onSubmit: (reason: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('corrections.web.edit.reasonTitle')}</DialogTitle>
          <DialogDescription>{t('corrections.web.edit.reasonHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="correction-reason">{t('corrections.fields.reason')}</Label>
          <Textarea id="correction-reason" maxLength={AUDIT_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!reason.trim() || busy} onClick={() => onSubmit(reason.trim())}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
