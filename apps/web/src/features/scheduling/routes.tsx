import { localDateSchema } from '@taskop/contracts';
import { useParams, useSearch } from '@tanstack/react-router';
import { AssignmentDetailPage, NewAssignmentPage } from './assignment-pages';
import type { OccurrenceTab } from './occurrence-dialog';
import { SchedulePage } from './schedule-page';

export function NewAssignmentRoute() {
  const s = useSearch({ strict: false }) as { checklistId?: string; copyFrom?: string };
  return <NewAssignmentPage checklistId={s.checklistId} copyFrom={s.copyFrom} />;
}

export function AssignmentDetailRoute() {
  const p = useParams({ strict: false }) as { assignmentId?: string };
  return <AssignmentDetailPage assignmentId={p.assignmentId!} />;
}

/** `/schedule?date=YYYY-MM-DD&occurrence=<id>&tab=execution`: the week to show and the drawer to open. */
export interface ScheduleSearch {
  date?: string;
  occurrence?: string;
  tab?: OccurrenceTab;
}

export const scheduleSearch = (s: Record<string, unknown>): ScheduleSearch => ({
  ...(localDateSchema.safeParse(s.date).success ? { date: s.date as string } : {}),
  ...(typeof s.occurrence === 'string' && s.occurrence ? { occurrence: s.occurrence } : {}),
  ...(s.tab === 'overview' || s.tab === 'execution' ? { tab: s.tab } : {}),
});

export function ScheduleRoute() {
  const s = useSearch({ strict: false }) as ScheduleSearch;
  // A new link remounts the page, so its week and drawer replace the current ones.
  return <SchedulePage key={`${s.date ?? ''}|${s.occurrence ?? ''}|${s.tab ?? ''}`} initialDate={s.date} initialOccurrenceId={s.occurrence} initialTab={s.tab} />;
}
