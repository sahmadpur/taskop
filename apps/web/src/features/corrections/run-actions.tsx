import { canCorrect, canSendBack, canWithdrawSendBack, type ExecutionDetail, type OccurrenceStatus } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { SendBackDialog } from './send-back-dialog';

/** The run's correction actions for executions.correct holders, each only where Part 1's rules allow it. */
export function RunActions({ status, detail, onCorrect }: { status: OccurrenceStatus; detail: ExecutionDetail; onCorrect: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const can = useCan('executions.correct');
  const [sending, setSending] = useState(false);
  const run = { status, executionState: detail.state };
  const correctable = canCorrect(run);
  const returnable = canSendBack(run);
  const withdrawable = canWithdrawSendBack(run);
  if (!can || !(correctable || returnable || withdrawable)) return null;

  const withdraw = async () => {
    try {
      await api.corrections.withdraw(detail.id);
      toast.success(t('corrections.web.withdraw.done'));
      await refreshRunViews(qc);
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {correctable && (
        <Button variant="outline" onClick={onCorrect}>
          {t('corrections.actions.correct')}
        </Button>
      )}
      {returnable && (
        <Button variant="outline" onClick={() => setSending(true)}>
          {t('corrections.actions.sendBack')}
        </Button>
      )}
      {withdrawable && (
        <ConfirmButton
          label={t('corrections.actions.withdraw')}
          title={t('corrections.web.withdraw.title')}
          description={t('corrections.web.withdraw.description')}
          onConfirm={withdraw}
        />
      )}
      {sending && <SendBackDialog detail={detail} onClose={() => setSending(false)} />}
    </div>
  );
}
