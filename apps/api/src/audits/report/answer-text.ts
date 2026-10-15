import { type Answer, isAnswered, type Item } from '@taskop/contracts';
import { az, interpolate } from '@taskop/i18n';

const L = az.audits.report;

/** An answer as the audit report prints it (spec §7.2). */
export function answerText(item: Item, a: Answer | undefined): string {
  if (!a || !isAnswered(item, a)) return L.noAnswer;
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny':
      return (a.optionIds ?? [])
        .map((id) => {
          const o = (item.options as ReadonlyArray<{ id: string; key: 'yes' | 'no' | 'confirm' | 'deny' }>).find((x) => x.id === id);
          return o ? az.checklists.builder.fixedOptions[o.key] : id;
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
export function answerLine(item: Item, a: Answer | undefined): string {
  const note = a?.note?.trim();
  return note ? `${answerText(item, a)} — ${note}` : answerText(item, a);
}
