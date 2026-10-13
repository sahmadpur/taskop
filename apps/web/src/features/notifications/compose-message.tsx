import { ApiError } from '@taskop/api-client';
import { MESSAGE_LIMITS, type SendMessageInput } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { canPreview, EMPTY_MESSAGE, type MessageDraft, previewVerdict, sendBody } from './message-form';
import { notificationKeys } from './queries';
import { TargetPicker } from './target-picker';

/** Spec §8, FR-15.08: compose → preview → "N nəfərə göndəriləcək" → send exactly what was previewed (decision 12). */
export function ComposeMessage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MessageDraft>(EMPTY_MESSAGE);
  const [pending, setPending] = useState<{ body: SendMessageInput; recipientCount: number } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MessageDraft>(key: K, value: MessageDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.fields && Object.keys(e.fields).length > 0) setFields(e.fields);
    else setError(errorText(t, e));
  };
  const preview = useMutation({
    mutationFn: (body: SendMessageInput) => api.messages.preview(body),
    onMutate: () => {
      setFields({});
      setError(null);
    },
    onSuccess: (p, body) => setPending({ body, recipientCount: p.recipientCount }),
    onError: fail,
  });
  const send = useMutation({
    mutationFn: (body: SendMessageInput) => api.messages.send(body),
    onSuccess: async () => {
      setPending(null);
      setDraft(EMPTY_MESSAGE);
      toast.success(t('notifications.messages.sent'));
      await qc.invalidateQueries({ queryKey: notificationKeys.messages });
    },
    onError: (e) => {
      setPending(null);
      fail(e);
    },
  });
  const verdict = pending ? previewVerdict(pending.recipientCount) : null;
  const targetError = fields.userIds ?? fields.teamIds ?? fields.siteIds;

  return (
    <>
      <form
        className="grid max-w-2xl gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canPreview(draft)) preview.mutate(sendBody(draft));
        }}
      >
        <TargetPicker value={draft.targets} onChange={(v) => set('targets', v)} />
        {targetError && <p className="text-destructive text-sm">{t(targetError)}</p>}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="message-title">{t('notifications.messages.titleLabel')}</Label>
            <span className="text-muted-foreground text-xs">{t('notifications.messages.counter', { count: draft.title.length, max: MESSAGE_LIMITS.titleMax })}</span>
          </div>
          <Input
            id="message-title"
            maxLength={MESSAGE_LIMITS.titleMax}
            value={draft.title}
            aria-invalid={Boolean(fields.title)}
            onChange={(e) => set('title', e.target.value)}
          />
          {fields.title && <p className="text-destructive text-sm">{t(fields.title)}</p>}
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="message-body">{t('notifications.messages.bodyLabel')}</Label>
            <span className="text-muted-foreground text-xs">{t('notifications.messages.counter', { count: draft.body.length, max: MESSAGE_LIMITS.bodyMax })}</span>
          </div>
          <Textarea
            id="message-body"
            rows={4}
            maxLength={MESSAGE_LIMITS.bodyMax}
            value={draft.body}
            aria-invalid={Boolean(fields.body)}
            onChange={(e) => set('body', e.target.value)}
          />
          {fields.body && <p className="text-destructive text-sm">{t(fields.body)}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="message-email" checked={draft.email} onCheckedChange={(c) => set('email', c === true)} />
          <Label htmlFor="message-email" className="font-normal">
            {t('notifications.messages.email')}
          </Label>
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-fit" disabled={!canPreview(draft) || preview.isPending}>
          {t('notifications.messages.send')}
        </Button>
      </form>
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && !send.isPending) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('notifications.messages.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {verdict?.ok === true && t('notifications.messages.confirm', { count: pending?.recipientCount })}
              {verdict?.ok === false && t(verdict.issue, { count: MESSAGE_LIMITS.maxRecipients, max: MESSAGE_LIMITS.maxRecipients })}
            </DialogDescription>
          </DialogHeader>
          {pending && <p className="font-medium">{pending.body.title}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={send.isPending} onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={verdict?.ok !== true || send.isPending} onClick={() => pending && send.mutate(pending.body)}>
              {t('notifications.messages.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
