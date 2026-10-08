import { type ChecklistContent, DATETIME_MODES, EVIDENCE_LEVELS, hasRules, type Item } from '@taskop/contracts';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { IssueIndex } from './issues';
import type { BuilderAction } from './reducer';
import { RulesEditor } from './rules-editor';
import { findItem, type NodeRef } from './tree';

interface Props {
  content: ChecklistContent;
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

const intOr = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Math.trunc(Number(v)));
const numOrNull = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function Inspector({ content, selected, issues, dispatch, readOnly }: Props) {
  const found = selected.kind === 'item' ? findItem(content, selected.id) : null;
  return (
    <aside className="min-h-0 overflow-y-auto rounded-md border p-4">
      {found ? (
        <ItemPanel item={found.item} depth={found.depth} scoring={content.scoring.enabled} issues={issues} dispatch={dispatch} readOnly={readOnly} />
      ) : (
        <SettingsPanel content={content} dispatch={dispatch} readOnly={readOnly} />
      )}
    </aside>
  );
}

function SettingsPanel({ content, dispatch, readOnly }: { content: ChecklistContent; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-3">
      <h2 className="font-semibold">{t('checklists.builder.settings')}</h2>
      <Field id={`${id}-ins`} label={t('checklists.builder.instructions')}>
        <Textarea
          id={`${id}-ins`}
          rows={6}
          maxLength={5000}
          disabled={readOnly}
          value={content.instructions ?? ''}
          onChange={(e) => dispatch({ type: 'updateSettings', patch: { instructions: e.target.value || null } })}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-sc`}
          checked={content.scoring.enabled}
          disabled={readOnly}
          onCheckedChange={(c) => dispatch({ type: 'updateSettings', patch: { scoring: { ...content.scoring, enabled: c === true } } })}
        />
        <Label htmlFor={`${id}-sc`} className="font-normal">
          {t('checklists.builder.scoringEnabled')}
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-pr`}
          checked={content.scoring.problemsReduceScore}
          disabled={readOnly || !content.scoring.enabled}
          onCheckedChange={(c) => dispatch({ type: 'updateSettings', patch: { scoring: { ...content.scoring, problemsReduceScore: c === true } } })}
        />
        <Label htmlFor={`${id}-pr`} className="font-normal">
          {t('checklists.builder.problemsReduceScore')}
        </Label>
      </div>
    </div>
  );
}

function ItemPanel({ item, depth, scoring, issues, dispatch, readOnly }: { item: Item; depth: number; scoring: boolean; issues: IssueIndex; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const patch = (p: Partial<Item>) => dispatch({ type: 'updateItem', itemId: item.id, patch: p });
  const media = item.type === 'photo' || item.type === 'video';
  return (
    <div className="grid gap-3">
      <h2 className="font-semibold">{t(`checklists.itemTypes.${item.type}`)}</h2>
      <Field id={`${id}-label`} label={t('checklists.builder.item.label')}>
        <Textarea id={`${id}-label`} maxLength={500} disabled={readOnly} value={item.label} onChange={(e) => patch({ label: e.target.value })} />
      </Field>
      <Field id={`${id}-help`} label={t('checklists.builder.item.helpText')}>
        <Textarea id={`${id}-help`} maxLength={2000} disabled={readOnly} value={item.helpText ?? ''} onChange={(e) => patch({ helpText: e.target.value || null })} />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id={`${id}-req`} checked={item.required} disabled={readOnly} onCheckedChange={(c) => patch({ required: c === true })} />
        <Label htmlFor={`${id}-req`} className="font-normal">
          {t('checklists.builder.item.required')}
        </Label>
      </div>
      {scoring && hasRules(item) && (
        <Field id={`${id}-w`} label={t('checklists.builder.item.weight')}>
          <Input id={`${id}-w`} type="number" min={0} max={100} disabled={readOnly} value={item.weight} onChange={(e) => patch({ weight: Math.min(100, Math.max(0, intOr(e.target.value, 0))) })} />
        </Field>
      )}
      {!media && (
        <div className="grid grid-cols-2 gap-2">
          {(['photo', 'video'] as const).map((kind) => (
            <Field key={kind} id={`${id}-${kind}`} label={t(`checklists.builder.item.${kind}`)}>
              <NativeSelect
                id={`${id}-${kind}`}
                disabled={readOnly}
                value={item.evidence[kind]}
                onChange={(e) => patch({ evidence: { ...item.evidence, [kind]: e.target.value } as Item['evidence'] })}
              >
                {EVIDENCE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`checklists.builder.evidence.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Checkbox id={`${id}-live`} checked={item.evidence.liveOnly} disabled={readOnly} onCheckedChange={(c) => patch({ evidence: { ...item.evidence, liveOnly: c === true } })} />
        <Label htmlFor={`${id}-live`} className="font-normal">
          {t('checklists.builder.item.liveOnly')}
        </Label>
      </div>
      <TypeFields item={item} patch={patch} readOnly={readOnly} />
      {(issues.byNode.get(item.id) ?? []).map((i) => (
        <p key={`${i.field}:${i.code}`} className="text-destructive text-sm">
          {t(i.code)}
        </p>
      ))}
      {hasRules(item) && <RulesEditor item={item} depth={depth} dispatch={dispatch} readOnly={readOnly} />}
    </div>
  );
}

function TypeFields({ item, patch, readOnly }: { item: Item; patch: (p: Partial<Item>) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  switch (item.type) {
    case 'single_choice':
    case 'multi_choice': {
      const setOptions = (options: typeof item.options) => {
        const keep = new Set(options.map((o) => o.id));
        // Rules must never point at a removed option.
        const rules = item.rules.map((r) => (r.when.kind === 'options' ? { ...r, when: { kind: 'options' as const, optionIds: r.when.optionIds.filter((x) => keep.has(x)) } } : r));
        patch({ options, rules });
      };
      const move = (i: number, d: -1 | 1) => {
        const next = [...item.options];
        const [o] = next.splice(i, 1);
        next.splice(i + d, 0, o!);
        setOptions(next);
      };
      return (
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t('checklists.builder.item.options')}</span>
          {item.options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-1">
              <Input
                aria-label={t('checklists.builder.item.option', { n: i + 1 })}
                maxLength={200}
                disabled={readOnly}
                value={o.label}
                onChange={(e) => setOptions(item.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)))}
              />
              {!readOnly && (
                <>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.item.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.item.moveDown')} disabled={i === item.options.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.item.removeOption')} onClick={() => setOptions(item.options.filter((x) => x.id !== o.id))}>
                    <X className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {!readOnly && item.options.length < 50 && (
            <Button variant="outline" size="sm" onClick={() => setOptions([...item.options, { id: crypto.randomUUID(), label: '' }])}>
              {t('checklists.builder.item.addOption')}
            </Button>
          )}
        </div>
      );
    }
    case 'number':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${id}-unit`} label={t('checklists.builder.item.unit')}>
            <Input id={`${id}-unit`} maxLength={20} disabled={readOnly} value={item.unit ?? ''} onChange={(e) => patch({ unit: e.target.value || null })} />
          </Field>
          <Field id={`${id}-dec`} label={t('checklists.builder.item.decimals')}>
            <Input id={`${id}-dec`} type="number" min={0} max={4} disabled={readOnly} value={item.decimals} onChange={(e) => patch({ decimals: Math.min(4, Math.max(0, intOr(e.target.value, 0))) })} />
          </Field>
          <Field id={`${id}-min`} label={t('checklists.builder.item.minValue')}>
            <Input id={`${id}-min`} type="number" disabled={readOnly} value={item.min ?? ''} onChange={(e) => patch({ min: numOrNull(e.target.value) })} />
          </Field>
          <Field id={`${id}-max`} label={t('checklists.builder.item.maxValue')}>
            <Input id={`${id}-max`} type="number" disabled={readOnly} value={item.max ?? ''} onChange={(e) => patch({ max: numOrNull(e.target.value) })} />
          </Field>
        </div>
      );
    case 'text':
    case 'comment':
      return (
        <Field id={`${id}-len`} label={t('checklists.builder.item.maxLength')}>
          <Input
            id={`${id}-len`}
            type="number"
            min={1}
            max={item.type === 'text' ? 500 : 5000}
            disabled={readOnly}
            value={item.maxLength}
            onChange={(e) => patch({ maxLength: Math.min(item.type === 'text' ? 500 : 5000, Math.max(1, intOr(e.target.value, 1))) })}
          />
        </Field>
      );
    case 'photo':
    case 'video': {
      const cap = item.type === 'photo' ? 20 : 5;
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${id}-minc`} label={t('checklists.builder.item.minCount')}>
            <Input id={`${id}-minc`} type="number" min={0} max={cap} disabled={readOnly} value={item.minCount} onChange={(e) => patch({ minCount: Math.min(cap, Math.max(0, intOr(e.target.value, 0))) })} />
          </Field>
          <Field id={`${id}-maxc`} label={t('checklists.builder.item.maxCount')}>
            <Input id={`${id}-maxc`} type="number" min={1} max={cap} disabled={readOnly} value={item.maxCount} onChange={(e) => patch({ maxCount: Math.min(cap, Math.max(1, intOr(e.target.value, 1))) })} />
          </Field>
        </div>
      );
    }
    case 'datetime':
      return (
        <Field id={`${id}-mode`} label={t('checklists.builder.item.mode')}>
          <NativeSelect id={`${id}-mode`} disabled={readOnly} value={item.mode} onChange={(e) => patch({ mode: e.target.value as (typeof DATETIME_MODES)[number] })}>
            {DATETIME_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`checklists.builder.item.modes.${m}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    default:
      return null;
  }
}
