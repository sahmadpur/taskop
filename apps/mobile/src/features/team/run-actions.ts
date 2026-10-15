import { type AuditBrief, canCorrect, canSendBack, canStartAudit, canWithdrawSendBack, type ExecutionState, type Me, type OccurrenceStatus } from '@taskop/contracts';

/** What the Team tab's run screen offers (spec §8.2). */
export interface RunActions {
  /** 'start' a new audit, 'open' the run's audit (in progress, paused or finished), or nothing. */
  audit: 'start' | 'open' | null;
  correct: boolean;
  sendBack: boolean;
  withdraw: boolean;
}

export const NO_ACTIONS: RunActions = { audit: null, correct: false, sendBack: false, withdraw: false };

/**
 * Each action needs its permission and the audit-logic rule the API applies (Part 1 "What the UI may offer"). A run
 * without a counted execution offers nothing. An audit that was cancelled counts as none.
 */
export function runActions(permissions: Me['permissions'], status: OccurrenceStatus, executionState: ExecutionState | null, audit: AuditBrief | null): RunActions {
  if (executionState === null) return NO_ACTIONS;
  const run = { status, executionState };
  const auditor = permissions.includes('audits.perform');
  const corrector = permissions.includes('executions.correct');
  const hasOpenAudit = audit !== null && audit.status !== 'cancelled';
  return {
    audit: !auditor ? null : hasOpenAudit ? 'open' : canStartAudit(run, false) ? 'start' : null,
    correct: corrector && canCorrect(run),
    sendBack: corrector && canSendBack(run),
    withdraw: corrector && canWithdrawSendBack(run),
  };
}
