import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type ExecutionDetail, type SendBackInput, visibleItems } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api, useMe } from '@/lib/session';
import { isNotInFuture, localInputToIso } from './labels';

/**
 * "Geri qaytar" (spec §8.3, decision 12): pick the items the worker must fix, a comment for each, and an optional due
 * date on the tenant's clock. Only the picked items reopen on the worker's phone.
 */
export function SendBackDialog({ detail, onClose }: { detail: ExecutionDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const qc = useQueryClient();
  const visible = useMemo(() => visibleItems(detail.content, detail.answers), [detail.content, detail.answers]);
  /** Picked item id → its comment, in the order the items were picked. */
  const [comments, setComments] = useState<Record<string, string>>({});
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const picked = visible.filter((v) => v.item.id in comments);

  const toggle = (itemId: string, on: boolean) =>
    setComments((c) => {
      const next = { ...c };
      if (on) next[itemId] = c[itemId] ?? '';
      else delete next[itemId];
      return next;
    });
  const send = useMutation({
    mutationFn: (body: SendBackInput) => api.corrections.sendBack(detail.id, body),
    onSuccess: () => {
      toast.success(t('corrections.web.sendBack.done'));
      onClose();
      void refreshRunViews(qc);
    },
    onError: (e) => setError(e instanceof ApiError && e.fields?.dueAt ? t(e.fields.dueAt) : errorText(t, e)),
  });
  const submit = () => {
    if (picked.length === 0) return setError(t('corrections.web.sendBack.noItems'));
    if (picked.some((v) => !comments[v.item.id]!.trim())) return setError(t('corrections.web.sendBack.commentRequired'));
    const dueAt = due ? localInputToIso(due, tenant.timezone) : null;
    if (dueAt && isNotInFuture(dueAt)) return setError(t('corrections.issues.dueInPast'));
    setError(null);
    send.mutate({ items: picked.map((v) => ({ itemId: v.item.id, comment: comments[v.item.id]!.trim() })), dueAt });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('corrections.web.sendBack.title')}</DialogTitle>
          <DialogDescription>{t('corrections.web.sendBack.hint')}</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('corrections.fields.items')}</legend>
          <ul className="grid gap-2">
            {visible.map((v) => {
              const id = `send-back-${v.item.id}`;
              const on = v.item.id in comments;
              return (
                <li key={v.item.id} className="grid gap-1.5" style={{ marginLeft: v.depth * 16 }}>
                  <div className="flex items-center gap-2">
                    <Checkbox id={id} checked={on} onCheckedChange={(c) => toggle(v.item.id, c === true)} />
                    <Label htmlFor={id} className="font-normal">
                      {v.item.label}
                    </Label>
                  </div>
                  {on && (
                    <Textarea
                      aria-label={t('corrections.web.sendBack.comment', { item: v.item.label })}
                      maxLength={AUDIT_LIMITS.reason}
                      value={comments[v.item.id]}
                      onChange={(e) => setComments((c) => ({ ...c, [v.item.id]: e.target.value }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="text-muted-foreground text-sm">{t('corrections.web.sendBack.selected', { count: picked.length })}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="send-back-due">{t('corrections.fields.dueAt')}</Label>
          <Input id="send-back-due" type="datetime-local" className="w-56" value={due} onChange={(e) => setDue(e.target.value)} />
          <p className="text-muted-foreground text-xs">{t('corrections.web.sendBack.dueHint')}</p>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={send.isPending} onClick={submit}>
            {t('corrections.actions.sendBack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
