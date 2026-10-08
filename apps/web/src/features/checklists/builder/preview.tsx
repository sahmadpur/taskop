import { type Answer, type Answers, type ChecklistContent, computeScore, hasRules, type Item, requirements, ruleMatches, visibleItems } from '@taskop/contracts';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { optionLabel } from '../labels';

export function PreviewPane({ content }: { content: ChecklistContent }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Answers>({});
  const visible = visibleItems(content, answers);
  const missing = requirements(content, answers);
  const score = computeScore(content, answers);
  const set = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-sm flex-col overflow-y-auto rounded-[2rem] border-8 border-slate-800 p-4" aria-label={t('checklists.builder.preview.title')}>
      <p role="status" className="bg-muted mb-3 rounded p-2 text-sm">
        {missing.length ? t('checklists.builder.preview.missing', { count: missing.length }) : t('checklists.builder.preview.complete')} ·{' '}
        {score.percent === null ? t('checklists.builder.preview.noScore') : t('checklists.builder.preview.score', { percent: score.percent })}
      </p>
      {content.instructions && <p className="text-muted-foreground mb-3 text-sm whitespace-pre-line">{content.instructions}</p>}
      {content.sections.map((s) => (
        <section key={s.id} className="mb-4 grid gap-3">
          <h3 className="font-semibold">{s.title}</h3>
          {s.instructions && <p className="text-muted-foreground text-xs whitespace-pre-line">{s.instructions}</p>}
          {visible
            .filter((v) => v.sectionId === s.id)
            .map((v) => (
              <PreviewItem
                key={v.item.id}
                item={v.item}
                depth={v.depth}
                answer={answers[v.item.id]}
                onChange={(p) => set(v.item.id, p)}
                missingKinds={missing.filter((m) => m.itemId === v.item.id).map((m) => m.kind)}
                problem={score.problems.find((p) => p.itemId === v.item.id)?.severity ?? null}
              />
            ))}
        </section>
      ))}
    </div>
  );
}

function PreviewItem(props: {
  item: Item;
  depth: number;
  answer: Answer | undefined;
  onChange: (p: Partial<Answer>) => void;
  missingKinds: string[];
  problem: 'normal' | 'critical' | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { item, answer, onChange } = props;
  const needs = (kind: string) => props.missingKinds.includes(kind);
  const rulesHit = hasRules(item) ? item.rules.filter((r) => ruleMatches(r, item, answer)) : [];
  const evidenceAsked = item.evidence.photo !== 'none' || rulesHit.some((r) => r.then.requirePhoto);
  const noteAsked = rulesHit.some((r) => r.then.requireNote);

  return (
    <div className="grid gap-1.5 rounded-md border p-2" style={{ marginLeft: props.depth * 12 }}>
      <label htmlFor={`${id}-in`} className="text-sm font-medium">
        {item.label}
        {item.required && <span className="text-destructive"> *</span>}
      </label>
      {item.helpText && <p className="text-muted-foreground text-xs">{item.helpText}</p>}
      {'options' in item && (
        <div role={item.type === 'multi_choice' ? 'group' : 'radiogroup'} className="flex flex-wrap gap-3">
          {item.options.map((o, i) => {
            const checked = answer?.optionIds?.includes(o.id) ?? false;
            const multi = item.type === 'multi_choice';
            return (
              <label key={o.id} className="flex items-center gap-1 text-sm">
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={id}
                  checked={checked}
                  onChange={() =>
                    onChange({ optionIds: multi ? (checked ? answer!.optionIds!.filter((x) => x !== o.id) : [...(answer?.optionIds ?? []), o.id]) : [o.id] })
                  }
                />
                {optionLabel(t, item, o, i)}
              </label>
            );
          })}
        </div>
      )}
      {item.type === 'number' && (
        <Input id={`${id}-in`} type="number" value={answer?.number ?? ''} onChange={(e) => onChange({ number: e.target.value === '' ? undefined : Number(e.target.value) })} />
      )}
      {item.type === 'text' && <Input id={`${id}-in`} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />}
      {item.type === 'comment' && <Textarea id={`${id}-in`} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />}
      {item.type === 'datetime' && (
        <Input
          id={`${id}-in`}
          type={item.mode === 'datetime' ? 'datetime-local' : item.mode}
          value={answer?.datetime ?? ''}
          onChange={(e) => onChange({ datetime: e.target.value })}
        />
      )}
      {(item.type === 'photo' || evidenceAsked) && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ photos: [...(answer?.photos ?? []), `p${(answer?.photos?.length ?? 0) + 1}`] })}>
          {t('checklists.builder.preview.addPhoto')} ({t('checklists.builder.preview.media', { count: answer?.photos?.length ?? 0 })})
        </Button>
      )}
      {(item.type === 'video' || item.evidence.video !== 'none' || rulesHit.some((r) => r.then.requireVideo)) && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ videos: [...(answer?.videos ?? []), `v${(answer?.videos?.length ?? 0) + 1}`] })}>
          {t('checklists.builder.preview.addVideo')} ({t('checklists.builder.preview.media', { count: answer?.videos?.length ?? 0 })})
        </Button>
      )}
      {noteAsked && <Textarea aria-label={t('checklists.builder.preview.note')} value={answer?.note ?? ''} onChange={(e) => onChange({ note: e.target.value })} />}
      {props.problem && (
        <p className="text-destructive text-xs font-medium">{props.problem === 'critical' ? t('checklists.builder.preview.critical') : t('checklists.builder.preview.problem')}</p>
      )}
      {['answer', 'photo', 'video', 'note', 'mediaCount'].filter(needs).map((k) => (
        <p key={k} className="text-destructive text-xs">
          {t(`checklists.builder.preview.missingKinds.${k}`)}
        </p>
      ))}
    </div>
  );
}
