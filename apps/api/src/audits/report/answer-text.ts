import { type Answer, isAnswered, type Item } from '@taskop/contracts';
import { interpolate, type Language, translationsFor } from '@taskop/i18n';

/** An answer as the audit report prints it (spec §7.2). */
export function answerText(item: Item, a: Answer | undefined, locale: Language): string {
  const T = translationsFor(locale);
  const L = T.audits.report;
  if (!a || !isAnswered(item, a)) return L.noAnswer;
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny':
      return (a.optionIds ?? [])
        .map((id) => {
          const o = (item.options as ReadonlyArray<{ id: string; key: 'yes' | 'no' | 'confirm' | 'deny' }>).find((x) => x.id === id);
          return o ? T.checklists.builder.fixedOptions[o.key] : id;
        })
        .join(', ');
    case 'single_choice':
    case 'multi_choice':
      return (a.optionIds ?? []).map((id) => item.options.find((x) => x.id === id)?.label || id).join(', ');
    case 'number':
      return `${a.number}${item.unit ? ` ${item.unit}` : ''}`;
    case 'text':
    case 'comment':
      return a.text!;
    case 'datetime':
      return a.datetime!;
    case 'photo':
      return interpolate(L.photos, { count: a.photos!.length });
    case 'video':
      return interpolate(L.videos, { count: a.videos!.length });
  }
}

/** The answer followed by the item's note. */
export function answerLine(item: Item, a: Answer | undefined, locale: Language): string {
  const note = a?.note?.trim();
  return note ? `${answerText(item, a, locale)} — ${note}` : answerText(item, a, locale);
}
