import { useQueryClient } from '@tanstack/react-query';
import { OccurrenceDialog, type OccurrenceTab } from '@/features/scheduling/occurrence-dialog';
import { TaskDrawer } from '@/features/tasks/task-drawer';
import { reportKeys } from './queries';

/**
 * The `/schedule` run drawer, unchanged (decision 1). Closing it refreshes the reports: the run may have been cancelled
 * there, and its lists and tiles must not keep it.
 */
export function RunDrawer({ id, tab, onClose }: { id: string; tab?: OccurrenceTab; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <OccurrenceDialog
      key={id}
      id={id}
      initialTab={tab}
      onClose={() => {
        onClose();
        void qc.invalidateQueries({ queryKey: reportKeys.all });
      }}
    />
  );
}

/** The `/tasks` drawer, unchanged; closing it refreshes the reports (a review may have completed the task). */
export function ReportTaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <TaskDrawer
      key={id}
      id={id}
      onClose={() => {
        onClose();
        void qc.invalidateQueries({ queryKey: reportKeys.all });
      }}
    />
  );
}
