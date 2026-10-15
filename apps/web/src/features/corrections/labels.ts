import type { Answer, Correction, ExecutionCorrections, Item, ReworkRequest, Score } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { answerValue, formatPercent } from '@/features/executions/labels';

/** One answer as a line for the diff and the timeline: the value, else the media counts, else "Cavab yoxdur"; then the note. */
export function answerSummary(t: TFunction, item: Item, a: Answer | null | undefined, formatDateTime: (iso: string) => string): string {
  const value = answerValue(t, item, a ?? undefined, formatDateTime);
  const photos = a?.photos?.length ?? 0;
  const videos = a?.videos?.length ?? 0;
  const main = value ?? (photos || videos ? t('corrections.web.media', { photos, videos }) : t('corrections.emptyAnswer'));
  const note = a?.note?.trim();
  return note ? `${main} · ${t('executions.note', { note })}` : main;
}

/** A run score (`executions.score`, or the original snapshot's) as text. */
export const scoreText = (t: TFunction, score: Score | null, locale: string): string =>
  score?.percent == null ? t('executions.noScore') : t('executions.percent', { value: formatPercent(score.percent, locale) });

export type TimelineEntry =
  | { kind: 'sentBack' | 'resubmitted' | 'withdrawn'; at: string; request: ReworkRequest }
  | { kind: 'correction'; at: string; correction: Correction };

/**
 * Every send-back, resubmit, withdrawal and changed item, oldest first (spec §8.3). On a tie the request events come
 * first, so a resubmit is listed before the changes it brought.
 */
export function correctionTimeline(c: ExecutionCorrections): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const r of c.reworkRequests) {
    entries.push({ kind: 'sentBack', at: r.requestedAt, request: r });
    if (r.resubmittedAt) entries.push({ kind: 'resubmitted', at: r.resubmittedAt, request: r });
    if (r.withdrawnAt) entries.push({ kind: 'withdrawn', at: r.withdrawnAt, request: r });
  }
  for (const x of c.corrections) entries.push({ kind: 'correction', at: x.at, correction: x });
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.i - b.i)
    .map(({ entry }) => entry);
}
