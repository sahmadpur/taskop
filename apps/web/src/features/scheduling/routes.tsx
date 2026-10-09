import { useParams, useSearch } from '@tanstack/react-router';
import { AssignmentDetailPage, NewAssignmentPage } from './assignment-pages';

export function NewAssignmentRoute() {
  const s = useSearch({ strict: false }) as { checklistId?: string; copyFrom?: string };
  return <NewAssignmentPage checklistId={s.checklistId} copyFrom={s.copyFrom} />;
}

export function AssignmentDetailRoute() {
  const p = useParams({ strict: false }) as { assignmentId?: string };
  return <AssignmentDetailPage assignmentId={p.assignmentId!} />;
}
