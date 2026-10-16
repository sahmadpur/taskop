import { type Answer, EXECUTION_LIMITS, type Item } from '@taskop/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { optionLabel } from '@/features/checklists/labels';
import { useMe } from '@/lib/session';
import { isoToLocalInput, localInputToIso, pruneAnswer } from './labels';
import { EmptyState } from '@/components/states';

const VALUE_FIELDS = ['optionIds', 'number', 'text', 'datetime'] as const;

/**
 * One item's values-only editor for a manager's correction (spec §1): choices, number, text, comment, date/time and the
 * note. Photos and videos stay as captured and the manual problem passes through untouched (decision 11).
 */
export function AnswerEditor({ item, answer, onChange }: { item: Item; answer: Answer | undefined; onChange: (next: Answer | undefined) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const name = useId();
  const patch = (p: Partial<Answer>) => onChange(pruneAnswer({ ...answer, ...p }));
  const media = item.type === 'photo' || item.type === 'video';
  const hasValue = VALUE_FIELDS.some((f) => answer?.[f] !== undefined);

  return (
    <div className="grid gap-2">
      {'options' in item &&
        (item.type === 'multi_choice' ? (
          <div role="group" aria-label={item.label} className="flex flex-wrap gap-3">
            {item.options.map((o, i) => {
              const checked = answer?.optionIds?.includes(o.id) ?? false;
              return (
                <label key={o.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => patch({ optionIds: checked ? (answer?.optionIds ?? []).filter((x) => x !== o.id) : [...(answer?.optionIds ?? []), o.id] })}
                  />
                  {optionLabel(t, item, o, i)}
                </label>
              );
            })}
          </div>
        ) : (
          <div role="radiogroup" aria-label={item.label} className="flex flex-wrap gap-3">
            {item.options.map((o, i) => (
              <label key={o.id} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name={name} checked={answer?.optionIds?.[0] === o.id} onChange={() => patch({ optionIds: [o.id] })} />
                {optionLabel(t, item, o, i)}
              </label>
            ))}
          </div>
        ))}
      {item.type === 'number' && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={item.label}
            type="number"
            className="w-40"
            min={item.min ?? undefined}
            max={item.max ?? undefined}
            step={item.decimals > 0 ? 10 ** -item.decimals : 1}
            value={answer?.number ?? ''}
            onChange={(e) => patch({ number: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          {item.unit && <span className="text-sm">{item.unit}</span>}
        </div>
      )}
      {item.type === 'text' && <Input aria-label={item.label} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => patch({ text: e.target.value })} />}
      {item.type === 'comment' && <Textarea aria-label={item.label} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => patch({ text: e.target.value })} />}
      {item.type === 'datetime' &&
        (item.mode === 'datetime' ? (
          <Input
            aria-label={item.label}
            type="datetime-local"
            className="w-56"
            value={answer?.datetime ? isoToLocalInput(answer.datetime, tenant.timezone) : ''}
            onChange={(e) => patch({ datetime: localInputToIso(e.target.value, tenant.timezone) ?? undefined })}
          />
        ) : (
          <Input aria-label={item.label} type={item.mode} className="w-44" value={answer?.datetime ?? ''} onChange={(e) => patch({ datetime: e.target.value })} />
        ))}
      {media && <EmptyState title={t('corrections.web.edit.mediaLocked')} />}
      {!media && hasValue && (
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => patch({ optionIds: undefined, number: undefined, text: undefined, datetime: undefined })}>
          {t('corrections.web.edit.clear')}
        </Button>
      )}
      <Textarea
        aria-label={t('corrections.web.edit.note', { item: item.label })}
        maxLength={EXECUTION_LIMITS.answerNote}
        value={answer?.note ?? ''}
        onChange={(e) => patch({ note: e.target.value })}
      />
    </div>
  );
}
