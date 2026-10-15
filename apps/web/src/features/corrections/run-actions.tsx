import { canCorrect, type ExecutionDetail, type OccurrenceStatus } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session';

/** The run's correction actions for executions.correct holders, only where Part 1's rules allow them. */
export function RunActions({ status, detail, onCorrect }: { status: OccurrenceStatus; detail: ExecutionDetail; onCorrect: () => void }) {
  const { t } = useTranslation();
  const can = useCan('executions.correct');
  if (!can || !canCorrect({ status, executionState: detail.state })) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={onCorrect}>
        {t('corrections.actions.correct')}
      </Button>
    </div>
  );
}
