import type { ClaimRejectionReason } from '@taskop/contracts';
import type { TFunction } from 'i18next';

/** Spec §7.2: "Bu checklist artıq {name} tərəfindən icra olunur" when the winner is known, else the reason. */
export function claimRejectionText(t: TFunction, reason: ClaimRejectionReason, byName: string | null): string {
  return reason === 'ALREADY_CLAIMED' && byName ? t('executions.alreadyClaimedBy', { name: byName }) : t(`executions.claimRejections.${reason}`);
}
