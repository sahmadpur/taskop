import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { AssignmentEditor } from './assignment-editor';
import { assignmentVariant, formatLocalDate, occurrenceVariant, scheduleSummary, useTimeFormat } from './labels';
import { useAssignment, useAssignments } from './queries';

export function AssignmentsPage() {
  const { t } = useTranslation();
  const canManage = useCan('assignments.manage');
  const sites = useSites();
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState<AssignmentStatus | ''>('active');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const list = useAssignments({ siteId: siteId || undefined, status: status || undefined, q: q || undefined });
  const items = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t('scheduling.assignments.title')}
        actions={
          canManage && (
            <Link to="/assignments/new" className={buttonVariants()}>
              {t('scheduling.assignments.add')}
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <NativeSelect aria-label={t('scheduling.assignments.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56">
          <option value="">{t('scheduling.assignments.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as AssignmentStatus | '')} className="w-48">
          <option value="">{t('scheduling.assignments.allStatuses')}</option>
          {ASSIGNMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`scheduling.assignments.status.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.name')}</TableHead>
            <TableHead>{t('scheduling.assignments.site')}</TableHead>
            <TableHead>{t('scheduling.assignments.schedule')}</TableHead>
            <TableHead>{t('scheduling.assignments.assignees')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="font-medium hover:underline">
                  {a.name ?? a.checklistName}
                </Link>
                {a.name && <div className="text-muted-foreground text-xs">{a.checklistName}</div>}
              </TableCell>
              <TableCell>{a.siteName}</TableCell>
              <TableCell>{scheduleSummary(t, a.schedule, a.timing, a.shiftName)}</TableCell>
              <TableCell>{t('scheduling.assignments.assigneeCount', { count: a.assignees.length })}</TableCell>
              <TableCell>
                <Badge variant={assignmentVariant(a.status)}>{t(`scheduling.assignments.status.${a.status}`)}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {list.isSuccess && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('scheduling.assignments.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function NewAssignmentPage({ checklistId, copyFrom }: { checklistId?: string; copyFrom?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const source = useAssignment(copyFrom);
  if (copyFrom && source.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return (
    <div>
      <PageHeader title={t('scheduling.assignments.createTitle')} />
      <AssignmentEditor
        preset={{ checklistId, copyFrom: source.data }}
        onSaved={(a) => void navigate({ to: '/assignments/$assignmentId', params: { assignmentId: a.id } })}
        onCancel={() => void navigate({ to: '/assignments' })}
      />
    </div>
  );
}

export function AssignmentDetailPage({ assignmentId }: { assignmentId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = useCan('assignments.manage');
  const time = useTimeFormat();
  const detail = useAssignment(assignmentId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['assignments'] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  if (detail.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (detail.error) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  const a = detail.data;
  const title = a.name ?? a.checklistName;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={title}
        actions={
          canManage && (
            <>
              {a.status === 'active' && (
                <Button variant="outline" onClick={() => void act(() => api.assignments.pause(a.id))}>
                  {t('scheduling.assignments.pause')}
                </Button>
              )}
              {a.status === 'paused' && (
                <Button variant="outline" onClick={() => void act(() => api.assignments.resume(a.id))}>
                  {t('scheduling.assignments.resume')}
                </Button>
              )}
              {a.status !== 'ended' && (
                <ConfirmButton
                  variant="destructive"
                  label={t('scheduling.assignments.end')}
                  title={t('scheduling.assignments.end')}
                  description={t('scheduling.assignments.confirmEnd', { name: title })}
                  onConfirm={() => act(() => api.assignments.end(a.id))}
                />
              )}
              <Button variant="outline" onClick={() => void navigate({ to: '/assignments/new', search: { copyFrom: a.id } })}>
                {t('scheduling.assignments.copyToSites')}
              </Button>
            </>
          )
        }
      />
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={assignmentVariant(a.status)}>{t(`scheduling.assignments.status.${a.status}`)}</Badge>
        <span>{a.checklistName}</span>
        <span>{a.siteName}</span>
        <span>{scheduleSummary(t, a.schedule, a.timing, a.shiftName)}</span>
      </div>
      <section aria-label={t('scheduling.assignments.upcoming')} className="grid gap-2">
        <h2 className="text-lg font-semibold">{t('scheduling.assignments.upcoming')}</h2>
        {a.upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('scheduling.assignments.noUpcoming')}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {a.upcoming.map((o) => (
              <li key={o.id} className="flex items-center gap-3">
                <span>
                  {formatLocalDate(o.localDate)} · {time(o.startsAt)}–{time(o.dueAt)}
                </span>
                <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
                {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canManage && a.status !== 'ended' && (
        <AssignmentEditor
          key={a.revision}
          initial={a}
          onSaved={() => {
            toast.success(t('scheduling.assignments.saved'));
            void refresh();
          }}
          onCancel={() => void navigate({ to: '/assignments' })}
        />
      )}
    </div>
  );
}
