import { CONTENT_LIMITS, type Item, NUMBER_OPS, RANGE_OPS, type Rule, type RuleItem } from '@taskop/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { optionLabel } from '../labels';
import { AddItemButton } from './canvas';
import type { BuilderAction } from './reducer';

const num = (v: string): number => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

function CheckField({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(c) => onChange(c === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

export function RulesEditor({ item, depth, dispatch, readOnly }: { item: RuleItem; depth: number; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <h3 className="text-sm font-semibold">{t('checklists.builder.rules.title')}</h3>
      {item.rules.map((rule, n) => (
        <RuleCard key={rule.id} item={item} rule={rule} n={n} depth={depth} dispatch={dispatch} readOnly={readOnly} />
      ))}
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'addRule', itemId: item.id })}>
          {t('checklists.builder.rules.add')}
        </Button>
      )}
    </div>
  );
}

function RuleCard({ item, rule, n, depth, dispatch, readOnly }: { item: RuleItem; rule: Rule; n: number; depth: number; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const update = (patch: { when?: Rule['when']; then?: Partial<Omit<Rule['then'], 'followUps'>> }) => dispatch({ type: 'updateRule', itemId: item.id, ruleId: rule.id, patch });
  const w = rule.when;
  const canNest = depth + 1 <= CONTENT_LIMITS.followUpDepth;

  return (
    <fieldset className="grid gap-2 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium">{t('checklists.builder.rules.ruleN', { n: n + 1 })}</legend>

      {item.type === 'number' ? (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-op`}>{t('checklists.builder.rules.whenNumber')}</Label>
          <NativeSelect
            id={`${id}-op`}
            disabled={readOnly}
            value={w.kind === 'options' ? 'lt' : w.op}
            onChange={(e) => {
              const op = e.target.value;
              if ((RANGE_OPS as readonly string[]).includes(op)) {
                const base = w.kind === 'number' ? w.value : w.kind === 'range' ? w.min : 0;
                update({ when: { kind: 'range', op: op as (typeof RANGE_OPS)[number], min: w.kind === 'range' ? w.min : base, max: w.kind === 'range' ? w.max : base } });
              } else {
                update({ when: { kind: 'number', op: op as (typeof NUMBER_OPS)[number], value: w.kind === 'number' ? w.value : w.kind === 'range' ? w.min : 0 } });
              }
            }}
          >
            {[...NUMBER_OPS, ...RANGE_OPS].map((op) => (
              <option key={op} value={op}>
                {t(`checklists.builder.rules.ops.${op}`)}
              </option>
            ))}
          </NativeSelect>
          {w.kind === 'number' && (
            <>
              <Label htmlFor={`${id}-v`}>{t('checklists.builder.rules.value')}</Label>
              <Input id={`${id}-v`} type="number" disabled={readOnly} value={w.value} onChange={(e) => update({ when: { ...w, value: num(e.target.value) } })} />
            </>
          )}
          {w.kind === 'range' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-min`}>{t('checklists.builder.item.min')}</Label>
                <Input id={`${id}-min`} type="number" disabled={readOnly} value={w.min} onChange={(e) => update({ when: { ...w, min: num(e.target.value) } })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-max`}>{t('checklists.builder.item.max')}</Label>
                <Input id={`${id}-max`} type="number" disabled={readOnly} value={w.max} onChange={(e) => update({ when: { ...w, max: num(e.target.value) } })} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-1">
          <span className="text-sm">{t('checklists.builder.rules.whenOptions')}</span>
          {item.options.map((o, i) => {
            const selected = w.kind === 'options' && w.optionIds.includes(o.id);
            return (
              <CheckField
                key={o.id}
                id={`${id}-o-${o.id}`}
                label={optionLabel(t, item, o, i)}
                checked={selected}
                disabled={readOnly}
                onChange={(on) => {
                  const current = w.kind === 'options' ? w.optionIds : [];
                  update({ when: { kind: 'options', optionIds: on ? [...current, o.id] : current.filter((x) => x !== o.id) } });
                }}
              />
            );
          })}
        </div>
      )}

      <Label htmlFor={`${id}-problem`}>{t('checklists.builder.rules.problem')}</Label>
      <NativeSelect
        id={`${id}-problem`}
        disabled={readOnly}
        value={rule.then.problem ?? 'none'}
        onChange={(e) => update({ then: { problem: e.target.value === 'none' ? null : (e.target.value as 'normal' | 'critical') } })}
      >
        <option value="none">{t('checklists.builder.rules.problemNone')}</option>
        <option value="normal">{t('checklists.builder.rules.problemNormal')}</option>
        <option value="critical">{t('checklists.builder.rules.problemCritical')}</option>
      </NativeSelect>
      <CheckField id={`${id}-note`} label={t('checklists.builder.rules.requireNote')} checked={rule.then.requireNote} disabled={readOnly} onChange={(v) => update({ then: { requireNote: v } })} />
      <CheckField id={`${id}-photo`} label={t('checklists.builder.rules.requirePhoto')} checked={rule.then.requirePhoto} disabled={readOnly} onChange={(v) => update({ then: { requirePhoto: v } })} />
      <CheckField id={`${id}-video`} label={t('checklists.builder.rules.requireVideo')} checked={rule.then.requireVideo} disabled={readOnly} onChange={(v) => update({ then: { requireVideo: v } })} />

      <span className="text-sm font-medium">{t('checklists.builder.rules.followUps')}</span>
      <ul className="grid gap-1">
        {rule.then.followUps.map((f: Item) => (
          <li key={f.id}>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => dispatch({ type: 'select', node: { kind: 'item', id: f.id } })}>
              {f.label || t('checklists.builder.untitledItem')}
            </Button>
          </li>
        ))}
      </ul>
      {!readOnly &&
        (canNest ? (
          <AddItemButton
            label={t('checklists.builder.addFollowUp')}
            onAdd={(type) => dispatch({ type: 'addItem', container: { kind: 'rule', itemId: item.id, ruleId: rule.id }, itemType: type })}
          />
        ) : (
          <p className="text-muted-foreground text-xs">{t('checklists.builder.rules.depthLimit')}</p>
        ))}
      {!readOnly && (
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'removeRule', itemId: item.id, ruleId: rule.id })}>
          {t('checklists.builder.rules.remove')}
        </Button>
      )}
    </fieldset>
  );
}
