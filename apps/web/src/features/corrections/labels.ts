import {
  type Answer,
  type Answers,
  changedItemIds,
  type CorrectAnswersInput,
  type Correction,
  type ExecutionCorrections,
  type Item,
  type ReworkRequest,
  type Score,
  tzOffsetMinutes,
  zonedTimeToUtc,
} from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { answerValue, formatPercent } from '@/features/executions/labels';

/** One answer as a line for the diff and the timeline: the value, else the media counts, else "Cavab yoxdur"; then the note. */
export function answerSummary(t: TFunction, item: Item, a: Answer | null | undefined, formatDateTime: (iso: string) => string, locale = 'az'): string {
  const value = answerValue(t, item, a ?? undefined, formatDateTime, locale);
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

/** An instant as a `datetime-local` value on the tenant's clock (Global Constraints), or '' when unreadable. */
export function isoToLocalInput(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + tzOffsetMinutes(tz, ms) * 60_000).toISOString().slice(0, 16);
}

/** A `datetime-local` value read on the tenant's clock, as an ISO instant; null for anything else. */
export function localInputToIso(value: string, tz: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return zonedTimeToUtc(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz).toISOString();
}

/** An answer without its empty fields; undefined when nothing is left (the item is then unanswered). */
export function pruneAnswer(a: Answer): Answer | undefined {
  const kept = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  return Object.keys(kept).length > 0 ? (kept as Answer) : undefined;
}

export type CorrectionChange = CorrectAnswersInput['changes'][number];

/** What a correction sends for one item (Part 1 decision 2): the answer without the manual problem, or null to clear it. */
export function correctionAnswer(a: Answer | undefined): CorrectionChange['answer'] {
  if (!a) return null;
  const { problem: _problem, ...values } = a;
  return pruneAnswer(values) ?? null;
}

/** One change per item whose answer differs (Part 1's `changedItemIds`), in its order. */
export const correctionChanges = (before: Answers, after: Answers): CorrectionChange[] =>
  changedItemIds(before, after).map((itemId) => ({ itemId, answer: correctionAnswer(after[itemId]) }));

/** Whether an ISO instant is not after now: a send-back's due date must still lie ahead. */
export const isNotInFuture = (iso: string): boolean => Date.parse(iso) <= Date.now();
