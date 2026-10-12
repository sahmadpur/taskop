import { ApiError } from '@taskop/api-client';
import {
  EVIDENCE_LEVELS,
  type EvidenceLevel,
  MEDIA_LIMITS,
  type ProblemDto,
  TASK_LIMITS,
  TASK_PRIORITIES,
  type TaskDetail,
  type TaskPriority,
} from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatLocalDate } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { api, useMe } from '@/lib/session';
import { AssigneePicker } from './assignee-picker';
import { sameChoice } from './labels';
import { type PendingMedia, prepareFiles, type ReadMediaMeta, readMediaMeta, uploadInstructionMedia } from './media-files';
import { storeTask, taskKeys, useTaskAssignees } from './queries';
import { changedFields, choiceOf, createBody, fieldErrors, formErrors, initialValues, type TaskFormErrors, type TaskFormValues } from './task-form';

const ACCEPT = [...MEDIA_LIMITS.mimeTypes.photo, ...MEDIA_LIMITS.mimeTypes.video].join(',');

interface Props {
  /** Edit this task; without it the dialog creates one. */
  task?: TaskDetail;
  /** Create the fix for this closed run's problem (spec §8): pre-filled, its site, review on. */
  problem?: ProblemDto;
  onClose: () => void;
  /** The created or saved task, also when the dialog is closed after a failed upload. */
  onSaved?: (task: TaskDetail) => void;
  /** Injected by tests: jsdom cannot decode images or videos. */
  readMeta?: ReadMediaMeta;
}

export function TaskDialog({ task: latest, problem, onClose, onSaved, readMeta = readMediaMeta }: Props) {
  const { t } = useTranslation();
  // The task as it was when the dialog opened: the prop follows refetches (and the uploads' own invalidation), but the
  // form is measured against what the user saw, so a later refetch never makes someone else's change look like theirs.
  const [task] = useState(latest);
  const qc = useQueryClient();
  const { tenant } = useMe();
  // A problem task's site comes from the problem (Part 1 decision 19): shown, never edited.
  const fixedSite = problem ? problem.siteName : task?.source === 'problem' ? (task.site?.name ?? '—') : null;
  // The sites a task may name (Part 1 decision 25), from the picker's endpoint; no `sites.view` needed (decision 16).
  const siteOptions = useTaskAssignees('', fixedSite === null).data?.sites ?? [];
  const [values, setValues] = useState<TaskFormValues>(() => initialValues({ task, problem }, tenant.timezone));
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [files, setFiles] = useState<PendingMedia[]>([]);
  const [saved, setSaved] = useState<TaskDetail | null>(null);
  // Once the task is stored, the form no longer sends anything: only the files can still be retried.
  const locked = saved !== null;
  const [newId] = useState(() => uuidv7());
  const [busy, setBusy] = useState(false);
  // True once everything is stored: Save stays off, so a late second press can neither create nor upload again.
  const [done, setDone] = useState(false);
  // A same-tick second press sees the state of the render before; the ref is set at once.
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const patchFile = (id: string, patch: Partial<PendingMedia>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  // Every registered instruction medium counts against the API's limit, pending ones included.
  const existing = task?.media.filter((m) => m.role === 'instruction').length ?? 0;
  const room = TASK_LIMITS.instructionMedia - existing - files.filter((f) => f.state !== 'refused').length;
  const reassigning = task !== undefined && values.assignee !== null && !sameChoice(values.assignee, choiceOf(task));
  // Editing keeps the task's current site selectable even if it is no longer offered (inactive, or out of scope).
  const visibleSites = task?.site && !siteOptions.some((s) => s.id === task.site?.id) ? [...siteOptions, task.site] : siteOptions;

  // Not while a save is on its way: the dialog would vanish before the user sees how it ended.
  const close = () => {
    if (busy) return;
    if (saved) onSaved?.(saved);
    onClose();
  };

  const addFiles = async (list: File[]) => {
    const next = await prepareFiles(list, room, readMeta);
    setFiles((fs) => [...fs, ...next]);
  };

  const submit = async () => {
    if (inFlight.current || done) return;
    const found = saved ? {} : formErrors(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      let stored = saved;
      // The server's own time for the task, from a request sent in THIS save (createdAt after a create, updatedAt after a
      // PATCH); the files are stamped no later than it. Null when no request was sent: then the picked time goes as it is.
      let serverTime: string | null = null;
      if (!stored) {
        if (task) {
          const body = changedFields(task, values, tenant.timezone);
          if (Object.keys(body).length) {
            stored = await api.tasks.update(task.id, body);
            serverTime = stored.updatedAt;
          } else {
            stored = task;
          }
        } else {
          stored = await api.tasks.create(createBody(newId, values, tenant.timezone, problem));
          serverTime = stored.createdAt;
        }
        setSaved(stored);
      }
      // The task exists now: a failed file is retried with the same id, never with a second task.
      const failed = await uploadInstructionMedia(stored.id, files, serverTime, patchFile);
      // Only an answer of this save is worth caching: the opening copy of an unchanged task may be older than the cache.
      if (serverTime !== null) await storeTask(qc, stored);
      if (files.some((f) => f.state !== 'refused')) await qc.invalidateQueries({ queryKey: taskKeys.detail(stored.id) });
      if (failed > 0) {
        setError(t('tasks.dialog.uploadFailed', { count: failed }));
        return;
      }
      setDone(true);
      toast.success(t(task ? 'tasks.dialog.saved' : 'tasks.dialog.created'));
      onSaved?.(stored);
      onClose();
    } catch (e) {
      setError(errorText(t, e));
      if (e instanceof ApiError) {
        if (e.fields) setErrors(fieldErrors(e.fields));
        // Someone else made the task first: let the problems page show it.
        if (e.code === 'PROBLEM_ALREADY_HAS_TASK') void qc.invalidateQueries({ queryKey: ['problems'] });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const fieldError = (key: keyof TaskFormErrors) => {
    const message = errors[key];
    return message ? <p className="text-destructive text-sm">{t(message)}</p> : null;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(task ? 'tasks.dialog.editTitle' : problem ? 'tasks.dialog.fromProblem' : 'tasks.dialog.createTitle')}</DialogTitle>
          <DialogDescription>{problem ? `${problem.checklistName} · ${formatLocalDate(problem.localDate)}` : t('tasks.dialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset disabled={locked} className="m-0 grid min-w-0 gap-4 border-0 p-0">
            <div className="grid gap-1.5">
              <Label htmlFor="task-title">{t('tasks.dialog.title')}</Label>
              <Input
                id="task-title"
                value={values.title}
                maxLength={TASK_LIMITS.titleMax}
                aria-invalid={Boolean(errors.title)}
                onChange={(e) => set('title', e.target.value)}
              />
              {fieldError('title')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-instructions">{t('tasks.dialog.instructions')}</Label>
              <Textarea
                id="task-instructions"
                value={values.instructions}
                maxLength={TASK_LIMITS.instructionsMax}
                onChange={(e) => set('instructions', e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="task-priority">{t('tasks.dialog.priority')}</Label>
                <NativeSelect id="task-priority" value={values.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`tasks.priorities.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                {fixedSite !== null ? (
                  <>
                    <span className="text-sm font-medium">{t('tasks.dialog.site')}</span>
                    <p className="text-sm">{t('tasks.dialog.siteFromProblem', { site: fixedSite })}</p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="task-site">{t('tasks.dialog.site')}</Label>
                    <NativeSelect id="task-site" value={values.siteId} aria-invalid={Boolean(errors.siteId)} onChange={(e) => set('siteId', e.target.value)}>
                      <option value="">{t('tasks.dialog.noSite')}</option>
                      {visibleSites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                    {fieldError('siteId')}
                  </>
                )}
              </div>
            </div>
            <div className="grid gap-1.5">
              <AssigneePicker label={t('tasks.dialog.assignee')} value={values.assignee} onChange={(c) => set('assignee', c)} />
              {fieldError('assignee')}
              {reassigning && <p className="text-muted-foreground text-sm">{t('tasks.dialog.reassignNote')}</p>}
            </div>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="task-due-date">{t('tasks.dialog.dueDate')}</Label>
                  <Input id="task-due-date" type="date" value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} className="w-44" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="task-due-time">{t('tasks.dialog.dueTime')}</Label>
                  <Input id="task-due-time" type="time" value={values.dueTime} onChange={(e) => set('dueTime', e.target.value)} className="w-32" />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">{t('tasks.dialog.dueHint', { timeZone: tenant.timezone })}</p>
              {fieldError('dueDate')}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="task-review" checked={values.requiresReview} onCheckedChange={(c) => set('requiresReview', c === true)} />
              <Label htmlFor="task-review" className="font-normal">
                {t('tasks.dialog.requiresReview')}
              </Label>
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('tasks.dialog.evidence')}</legend>
              <div className="flex flex-wrap items-center gap-3">
                {(['photo', 'video'] as const).map((kind) => (
                  <NativeSelect
                    key={kind}
                    aria-label={t(kind === 'photo' ? 'tasks.dialog.evidencePhoto' : 'tasks.dialog.evidenceVideo')}
                    value={values.evidence[kind]}
                    onChange={(e) => set('evidence', { ...values.evidence, [kind]: e.target.value as EvidenceLevel })}
                    className="w-44"
                  >
                    {EVIDENCE_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {t(`tasks.evidenceLevels.${level}`)}
                      </option>
                    ))}
                  </NativeSelect>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="task-live-only"
                  checked={values.evidence.liveOnly}
                  onCheckedChange={(c) => set('evidence', { ...values.evidence, liveOnly: c === true })}
                />
                <Label htmlFor="task-live-only" className="font-normal">
                  {t('tasks.dialog.liveOnly')}
                </Label>
              </div>
            </fieldset>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="task-media">{t('tasks.dialog.media')}</Label>
            <Input
              id="task-media"
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy || room <= 0}
              onChange={(e) => {
                const list = [...(e.target.files ?? [])];
                e.target.value = '';
                if (list.length) void addFiles(list);
              }}
            />
            <p className="text-muted-foreground text-xs">{t('tasks.dialog.mediaLimit', { count: TASK_LIMITS.instructionMedia })}</p>
            {files.length > 0 && (
              <ul aria-label={t('tasks.dialog.files')} className="grid gap-1 text-sm">
                {files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.file.name}</span>
                    <span className={f.state === 'failed' || f.state === 'refused' ? 'text-destructive' : 'text-muted-foreground'}>
                      {t(`tasks.dialog.fileStates.${f.state}`)}
                    </span>
                    {f.error && <span className="text-destructive">{t(f.error, { count: TASK_LIMITS.instructionMedia })}</span>}
                    {(f.state === 'waiting' || f.state === 'failed' || f.state === 'refused') && (
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>
                        {t('tasks.dialog.remove')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || done} onClick={() => void submit()}>
            {saved ? t('tasks.dialog.retryUpload') : t(task ? 'common.save' : 'common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
