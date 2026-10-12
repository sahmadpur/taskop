import { ApiError } from '@taskop/api-client';
import { isFinalTaskStatus, type ProblemDto, TASK_LIMITS, type TaskDetail, type TaskMediaDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { severityVariant } from '@/features/executions/labels';
import { formatLocalDate } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { api } from '@/lib/session';
import { assigneeText, historyComment, taskStatusVariant } from './labels';
import { storeTask, taskKeys, useTask } from './queries';
import { TaskDialog } from './task-dialog';
import { ProblemMediaStrip, TaskMediaStrip } from './task-media';

/** The task drawer (spec §8), opened by `/tasks?task=<id>`. What the caller may do comes from canManage / canReview. */
export function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const task = useTask(id);
  const [editing, setEditing] = useState(false);
  // Kept here, not in the actions: a refused action may refetch a task whose actions then disappear.
  const [actionError, setActionError] = useState<string | null>(null);
  // The task may have become unreadable for the caller (a command moved it out of their scope, or it was removed):
  // show that, not the copy we still hold.
  const gone = task.isError && task.error instanceof ApiError && task.error.status === 404;
  const d = gone ? undefined : task.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{d?.title ?? (task.isError ? t('tasks.drawer.title') : t('common.loading'))}</DialogTitle>
          {d && <DialogDescription>{t('tasks.drawer.createdBy', { name: d.createdBy.fullName, time: formatDateTime(d.createdAt) })}</DialogDescription>}
        </DialogHeader>
        {task.isError && <p className="text-destructive text-sm">{errorText(t, task.error)}</p>}
        {!gone && <FormError message={actionError} />}
        {d && <TaskBody task={d} onEdit={() => setEditing(true)} onError={setActionError} />}
        {editing && d && <TaskDialog task={d} onClose={() => setEditing(false)} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TaskBody({ task, onEdit, onError }: { task: TaskDetail; onEdit: () => void; onError: (message: string | null) => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const media = useMemo(() => new Map(task.media.map((m) => [m.id, m])), [task.media]);
  const pick = (ids: string[]) => ids.map((m) => media.get(m)).filter((m): m is TaskMediaDto => m !== undefined);
  const e = task.evidence;
  const evidence =
    t('tasks.drawer.evidenceValue', { photo: t(`tasks.evidenceLevels.${e.photo}`), video: t(`tasks.evidenceLevels.${e.video}`) }) +
    (e.liveOnly ? ` · ${t('tasks.drawer.liveOnly')}` : '');

  return (
    <div className="grid gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={taskStatusVariant(task.status)}>{t(`tasks.statuses.${task.status}`)}</Badge>
        {task.overdueAt && <Badge variant="destructive">{t('tasks.flags.overdue')}</Badge>}
        <Badge variant="outline">{t(`tasks.priorities.${task.priority}`)}</Badge>
      </div>
      {task.assigneeInactive && !isFinalTaskStatus(task.status) && (
        <Alert variant="destructive">
          <AlertDescription>{t('tasks.drawer.inactive')}</AlertDescription>
        </Alert>
      )}
      {task.cancelReason && <p>{t('tasks.drawer.cancelReason', { reason: task.cancelReason })}</p>}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={t('tasks.drawer.assignee')}>{assigneeText(t, task)}</Field>
        <Field label={t('tasks.drawer.site')}>{task.site?.name ?? '—'}</Field>
        <Field label={t('tasks.drawer.due')}>{task.dueAt ? formatDateTime(task.dueAt) : '—'}</Field>
        <Field label={t('tasks.drawer.review')}>{t(task.requiresReview ? 'tasks.drawer.reviewRequired' : 'tasks.drawer.reviewNotRequired')}</Field>
        <Field label={t('tasks.drawer.evidence')}>{evidence}</Field>
      </dl>
      <section aria-label={t('tasks.drawer.instructions')} className="grid gap-2">
        <h3 className="font-medium">{t('tasks.drawer.instructions')}</h3>
        {task.instructions ? <p className="whitespace-pre-line">{task.instructions}</p> : <p className="text-muted-foreground">{t('tasks.drawer.noInstructions')}</p>}
        <TaskMediaStrip media={task.media.filter((m) => m.role === 'instruction')} />
      </section>
      {task.problem && <ProblemCard taskId={task.id} problem={task.problem} />}
      <section aria-label={t('tasks.drawer.submissions')} className="grid gap-2">
        <h3 className="font-medium">{t('tasks.drawer.submissions')}</h3>
        {task.submissions.length === 0 ? (
          <p className="text-muted-foreground">{t('tasks.drawer.noSubmissions')}</p>
        ) : (
          <ol className="grid gap-2">
            {task.submissions.map((s, i) => {
              const name = t('tasks.drawer.submission', { n: i + 1 });
              return (
                <li key={s.id} aria-label={name} className="grid gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground text-xs">{t('tasks.drawer.by', { name: s.submittedBy.fullName, time: formatDateTime(s.submittedAt) })}</span>
                    {s.reviewDecision && (
                      <Badge variant={s.reviewDecision === 'approved' ? 'default' : 'destructive'}>{t(`tasks.reviewDecisions.${s.reviewDecision}`)}</Badge>
                    )}
                  </div>
                  {s.text && <p className="whitespace-pre-line">{s.text}</p>}
                  <TaskMediaStrip media={pick(s.mediaIds)} />
                  {s.reviewComment && <p>{t('tasks.drawer.reviewComment', { comment: s.reviewComment })}</p>}
                  {s.reviewedBy && s.reviewedAt && (
                    <p className="text-muted-foreground text-xs">{t('tasks.drawer.by', { name: s.reviewedBy.fullName, time: formatDateTime(s.reviewedAt) })}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <Actions task={task} onEdit={onEdit} onError={onError} />
      <section aria-label={t('tasks.drawer.history')} className="grid gap-1">
        <h3 className="font-medium">{t('tasks.drawer.history')}</h3>
        <ol className="grid gap-1">
          {task.history.map((h) => {
            const comment = historyComment(t, h.comment);
            return (
              <li key={h.id}>
                {formatDateTime(h.at)} · {h.fromStatus ? `${t(`tasks.statuses.${h.fromStatus}`)} → ` : ''}
                {t(`tasks.statuses.${h.toStatus}`)} · {h.actor?.fullName ?? t('tasks.drawer.system')}
                {comment ? ` · ${comment}` : ''}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function ProblemCard({ taskId, problem: p }: { taskId: string; problem: ProblemDto }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('tasks.drawer.problem')} className="grid gap-2 rounded-md border p-3">
      <h3 className="font-medium">{t('tasks.drawer.problem')}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
        <span>{p.itemLabel ?? t('executions.problemsPage.unknownItem')}</span>
      </div>
      <p className="text-muted-foreground">{[p.checklistName, p.siteName, formatLocalDate(p.localDate), p.executorName].join(' · ')}</p>
      {p.note && <p className="whitespace-pre-line">{p.note}</p>}
      <ProblemMediaStrip taskId={taskId} media={p.media} />
      <Link
        to="/schedule"
        search={{ date: p.localDate, occurrence: p.occurrenceId, tab: 'execution' }}
        className="w-fit underline-offset-4 hover:underline"
      >
        {t('tasks.drawer.openRun')}
      </Link>
    </section>
  );
}

function Actions({ task, onEdit, onError }: { task: TaskDetail; onEdit: () => void; onError: (message: string | null) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Set synchronously: two presses in one tick both see `busy === false`, and Approve / Reject / Cancel share this guard.
  const inFlight = useRef(false);
  const decide = task.canReview && task.status === 'awaiting_review';
  const change = task.canManage && !isFinalTaskStatus(task.status);
  if (!decide && !change) return null;

  const run = async (command: () => Promise<TaskDetail>, done: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onError(null);
    try {
      await storeTask(qc, await command());
      setComment('');
      setReason('');
      toast.success(t(done));
    } catch (e) {
      onError(errorText(t, e));
      // Someone else moved the task meanwhile (a new submission, another reviewer, a cancel): show it as it is now.
      if (e instanceof ApiError && e.status === 409) await qc.invalidateQueries({ queryKey: taskKeys.detail(task.id) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label={t('common.actions')} className="grid gap-4 border-t pt-3">
      {decide && (
        <div className="grid gap-2">
          <Button className="w-fit" disabled={busy} onClick={() => void run(() => api.tasks.review(task.id, { decision: 'approve' }), 'tasks.drawer.approved')}>
            {t('tasks.drawer.approve')}
          </Button>
          <Label htmlFor="task-reject-comment">{t('tasks.drawer.rejectComment')}</Label>
          <Textarea id="task-reject-comment" value={comment} maxLength={TASK_LIMITS.commentMax} onChange={(e) => setComment(e.target.value)} />
          <Button
            variant="outline"
            className="w-fit"
            disabled={busy || !comment.trim()}
            onClick={() => void run(() => api.tasks.review(task.id, { decision: 'reject', comment: comment.trim() }), 'tasks.drawer.rejected')}
          >
            {t('tasks.drawer.reject')}
          </Button>
        </div>
      )}
      {change && (
        <div className="grid gap-2">
          <Button variant="outline" className="w-fit" onClick={onEdit}>
            {t('common.edit')}
          </Button>
          <Label htmlFor="task-cancel-reason">{t('tasks.drawer.cancelLabel')}</Label>
          <Textarea id="task-cancel-reason" value={reason} maxLength={TASK_LIMITS.commentMax} onChange={(e) => setReason(e.target.value)} />
          <Button
            variant="destructive"
            className="w-fit"
            disabled={busy || !reason.trim()}
            onClick={() => void run(() => api.tasks.cancel(task.id, { reason: reason.trim() }), 'tasks.drawer.cancelled')}
          >
            {t('tasks.drawer.cancel')}
          </Button>
        </div>
      )}
    </section>
  );
}
