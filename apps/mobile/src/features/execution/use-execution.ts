import type { ContentLoad } from '@/offline/content';
import type { MediaRefusal } from '@/offline/execution-store';
import { useLiveQuery } from '@/offline/hooks';
import type { LocalExecution, LocalMedia, LocalOccurrence } from '@/offline/local-model';

export interface ExecutionData {
  execution: LocalExecution;
  occurrence: LocalOccurrence;
  content: ContentLoad;
  media: LocalMedia[];
  /** Media the server refused for good, noted on their items. */
  refusals: MediaRefusal[];
}

/**
 * The current execution of an occurrence. Resolved from the occurrence on every change, never by a remembered
 * execution id: the sync engine moves an execution to the server's id when it adopts my other install's claim.
 * `undefined` while loading, `null` when the occurrence or an execution of it is not on this phone.
 */
export function useExecution(occurrenceId: string): ExecutionData | null | undefined {
  return useLiveQuery(async ({ store }) => {
    const view = (await store.occurrences()).find((o) => o.id === occurrenceId);
    if (!view?.execution) return null;
    const { execution, ...occurrence } = view;
    return {
      execution,
      occurrence,
      content: await store.content(execution.checklistVersionId),
      media: await store.media(execution.id),
      refusals: await store.mediaRefusals(execution.id),
    };
  }, [occurrenceId]);
}

/** Why the worker can no longer change an execution's answers. */
export type ReadOnlyReason = 'rejected' | 'claimedByOther' | 'completed' | 'locked';

/**
 * The one place that decides whether an execution is read-only (the execution and finish screens share it):
 * our claim was rejected, a pull shows another worker holding the claim, it is completed, or it is locked
 * (partial, or the device clock has reached closes_at).
 */
export function readOnlyReason(e: LocalExecution, o: LocalOccurrence, userId: string, now: number): ReadOnlyReason | null {
  if (e.state === 'rejected') return 'rejected';
  if (o.claim && o.claim.executorUserId !== userId) return 'claimedByOther';
  if (e.state === 'completed') return 'completed';
  if (e.state !== 'active' || now >= Date.parse(o.closesAt)) return 'locked';
  return null;
}
