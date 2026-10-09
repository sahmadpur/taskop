import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/session';
import { assignmentVariant, scheduleSummary } from './labels';
import { useAssignments } from './queries';

/** The checklist page's view of where and when the checklist runs (spec §8 item 5). Tenant users only. */
export function ChecklistAssignments({ checklistId, canAssign }: { checklistId: string; canAssign: boolean }) {
  const { t } = useTranslation();
  const canView = useCan('assignments.view');
  const canManage = useCan('assignments.manage');
  const list = useAssignments({ checklistId }, canView);
  if (!canView) return null;
  const items = list.data?.items ?? [];
  return (
    <section aria-label={t('scheduling.assignments.forChecklist')} className="grid gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('scheduling.assignments.forChecklist')}</h2>
        {canManage && canAssign && (
          <Link to="/assignments/new" search={{ checklistId }} className={buttonVariants({ size: 'sm' })}>
            {t('scheduling.assignments.assign')}
          </Link>
        )}
      </div>
      {list.isSuccess && items.length === 0 && <p className="text-muted-foreground text-sm">{t('scheduling.assignments.empty')}</p>}
      {items.length > 0 && (
        <Table>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="font-medium hover:underline">
                    {a.name ?? a.checklistName}
                  </Link>
                </TableCell>
                <TableCell>{a.siteName}</TableCell>
                <TableCell>{scheduleSummary(t, a.schedule, a.timing, a.shiftName)}</TableCell>
                <TableCell>
                  <Badge variant={assignmentVariant(a.status)}>{t(`scheduling.assignments.status.${a.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
