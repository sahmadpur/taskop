import type { OccurrenceHistoryEntry } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { api, useCan } from '@/lib/session';
import { cancelReasonText, occurrenceVariant } from './labels';
import { useOccurrence } from './queries';

export function OccurrenceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('assignments.manage');
  const formatDateTime = useFormatDateTime();
  const occurrence = useOccurrence(id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = occurrence.data;

  const actor = (h: OccurrenceHistoryEntry) =>
    h.actor.kind === 'user' ? (h.actor.name ?? '—') : h.actor.kind === 'platform' ? t('scheduling.schedule.actorPlatform') : t('scheduling.schedule.actorSystem');

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.occurrences.cancel(id, { reason: reason.trim() });
      await qc.invalidateQueries({ queryKey: ['occurrences'] });
      await qc.invalidateQueries({ queryKey: ['assignments'] });
      toast.success(t('scheduling.schedule.cancelled'));
      onClose();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{o?.checklistName ?? t('common.loading')}</DialogTitle>
          {o && <DialogDescription>{[o.assignmentName, o.siteName, o.shiftName].filter(Boolean).join(' · ')}</DialogDescription>}
        </DialogHeader>
        {o && (
          <div className="grid gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
              {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
            </div>
            <p>{t('scheduling.schedule.window', { start: formatDateTime(o.startsAt), due: formatDateTime(o.dueAt), close: formatDateTime(o.closesAt) })}</p>
            <div>
              <h3 className="font-medium">{t('scheduling.schedule.assignees')}</h3>
              {o.assignees.length ? (
                <ul>
                  {o.assignees.map((u) => (
                    <li key={u.id}>{u.fullName}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('scheduling.schedule.unassigned')}</p>
              )}
            </div>
            <div>
              <h3 className="font-medium">{t('scheduling.schedule.history')}</h3>
              <ol className="grid gap-1">
                {o.history.map((h, i) => (
                  <li key={i}>
                    {formatDateTime(h.at)} · {h.fromStatus ? `${t(`scheduling.statuses.${h.fromStatus}`)} → ` : ''}
                    {t(`scheduling.statuses.${h.toStatus}`)} · {actor(h)}
                    {h.reason ? ` · ${cancelReasonText(t, h.reason)}` : ''}
                  </li>
                ))}
              </ol>
            </div>
            {canManage && (o.status === 'pending' || o.status === 'overdue') && (
              <div className="grid gap-2">
                <Label htmlFor="cancel-reason">{t('scheduling.schedule.cancelReason')}</Label>
                <Textarea id="cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                <FormError message={error} />
                <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => void cancel()}>
                  {t('scheduling.schedule.cancel')}
                </Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
