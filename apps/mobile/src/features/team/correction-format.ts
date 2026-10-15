import type { Answer, Item } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { answerText } from '@/features/execution/answer-view';
import { choiceOptions } from '@/features/execution/parts';

/** An answer as one line for the corrections timeline: the chosen options, the value, how many files, then the note. */
export function answerSummary(t: TFunction, item: Item | undefined, a: Answer | null): string {
  if (!item || !a) return t('corrections.emptyAnswer');
  const parts: string[] = [];
  const options = choiceOptions(item, t);
  if (options && a.optionIds?.length) parts.push(options.filter((o) => a.optionIds!.includes(o.id)).map((o) => o.label).join(', '));
  const text = answerText(item, a);
  if (text !== null) parts.push(text);
  const files = (a.photos?.length ?? 0) + (a.videos?.length ?? 0);
  if (files > 0) parts.push(t('mobile.team.history.media', { count: files }));
  if (a.note?.trim()) parts.push(t('executions.note', { note: a.note.trim() }));
  return parts.length > 0 ? parts.join(' · ') : t('corrections.emptyAnswer');
}
