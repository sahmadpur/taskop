import { isoWeekday, type Recurrence, RECURRENCE_KINDS, type RecurrenceKind, SCHEDULING_LIMITS, type ShiftDto, type Timing } from '@taskop/contracts';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatLocalDate } from './labels';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const NTHS = [1, 2, 3, 4, -1] as const;

export function defaultRecurrence(kind: RecurrenceKind, today: string): Recurrence {
  const range = { startDate: today, endDate: null, skipDates: [] as string[] };
  switch (kind) {
    case 'once':
      return { kind, date: today };
    case 'daily':
      return { kind, every: 1, ...range };
    case 'weekly':
      return { kind, every: 1, weekdays: [isoWeekday(today)], ...range };
    case 'monthly':
      return { kind, every: 1, by: { dayOfMonth: Number(today.slice(8, 10)) }, ...range };
    case 'dates':
      return { kind, dates: [today] };
  }
}

export function defaultTiming(mode: Timing['mode'], shifts: ShiftDto[]): Timing {
  return mode === 'fixed'
    ? { mode, startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 }
    : { mode, shiftId: shifts.find((s) => s.active)?.id ?? '', graceMinutes: 0 };
}

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  // The draft is what the user is typing; it re-syncs whenever `value` changes from outside.
  const [state, setState] = useState({ draft: String(value), seen: value });
  const draft = state.seen === value ? state.draft : String(value);
  const parse = (text: string) => {
    const n = Number(text);
    return text.trim() !== '' && Number.isInteger(n) ? n : null;
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          const text = e.target.value;
          const n = parse(text);
          if (n !== null && n >= min && n <= max) {
            setState({ draft: text, seen: n });
            if (n !== value) onChange(n);
          } else {
            setState({ draft: text, seen: value });
          }
        }}
        onBlur={() => {
          const n = parse(draft);
          const fixed = n === null ? value : Math.min(max, Math.max(min, n));
          setState({ draft: String(fixed), seen: fixed });
          if (fixed !== value) onChange(fixed);
        }}
      />
    </div>
  );
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A list of dates with an "add" input. `min` dates can never be removed. */
function DateList({ id, label, values, min, onChange }: { id: string; label: string; values: string[]; min: number; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [next, setNext] = useState('');
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <ul className="flex flex-wrap gap-2">
        {values.map((d) => (
          <li key={d} className="flex items-center gap-1 rounded border px-2 py-0.5 text-sm">
            {formatLocalDate(d)}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`${t('scheduling.builder.remove')} ${d}`}
              disabled={values.length <= min}
              onClick={() => onChange(values.filter((x) => x !== d))}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input id={id} type="date" value={next} onChange={(e) => setNext(e.target.value)} className="w-48" />
        <Button
          type="button"
          variant="outline"
          disabled={!next}
          onClick={() => {
            if (next && !values.includes(next)) onChange([...values, next].sort());
            setNext('');
          }}
        >
          {t('scheduling.builder.addDate')}
        </Button>
      </div>
    </div>
  );
}

interface RecurrenceEditorProps {
  value: Recurrence;
  onChange: (r: Recurrence) => void;
  today: string;
  disabled?: boolean;
}

export function RecurrenceEditor({ value, onChange, today, disabled }: RecurrenceEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const everyLabel = { daily: 'everyDays', weekly: 'everyWeeks', monthly: 'everyMonths' } as const;
  const maxEvery = { daily: 365, weekly: 52, monthly: 12 } as const;
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{t('scheduling.assignments.schedule')}</legend>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-kind`}>{t('scheduling.builder.kind')}</Label>
        <NativeSelect id={`${id}-kind`} value={value.kind} onChange={(e) => onChange(defaultRecurrence(e.target.value as RecurrenceKind, today))}>
          {RECURRENCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`scheduling.builder.kinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {value.kind === 'once' && <DateField id={`${id}-date`} label={t('scheduling.builder.date')} value={value.date} onChange={(date) => date && onChange({ ...value, date })} />}
      {value.kind === 'dates' && (
        <DateList id={`${id}-dates`} label={t('scheduling.builder.dates')} values={value.dates} min={1} onChange={(dates) => onChange({ ...value, dates })} />
      )}

      {(value.kind === 'daily' || value.kind === 'weekly' || value.kind === 'monthly') && (
        <>
          <NumberField
            id={`${id}-every`}
            label={t(`scheduling.builder.${everyLabel[value.kind]}`)}
            value={value.every}
            min={1}
            max={maxEvery[value.kind]}
            onChange={(every) => onChange({ ...value, every })}
          />
          {value.kind === 'weekly' && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('scheduling.builder.weekdays')}</legend>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`${id}-wd-${d}`}
                      checked={value.weekdays.includes(d)}
                      onCheckedChange={(c) => {
                        const set = new Set(value.weekdays);
                        if (c === true) set.add(d);
                        else if (set.size > 1) set.delete(d);
                        onChange({ ...value, weekdays: [...set].sort((a, b) => a - b) });
                      }}
                    />
                    <Label htmlFor={`${id}-wd-${d}`} className="font-normal">
                      {t(`scheduling.weekdays.${d}`)}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          {value.kind === 'monthly' && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('scheduling.builder.monthlyBy')}</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={`${id}-by`}
                    checked={'dayOfMonth' in value.by}
                    onChange={() => onChange({ ...value, by: { dayOfMonth: Number(value.startDate.slice(8, 10)) } })}
                  />
                  {t('scheduling.builder.byDay')}
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name={`${id}-by`} checked={'nth' in value.by} onChange={() => onChange({ ...value, by: { nth: 1, weekday: isoWeekday(value.startDate) } })} />
                  {t('scheduling.builder.byWeekday')}
                </label>
              </div>
              {'dayOfMonth' in value.by ? (
                <NumberField id={`${id}-dom`} label={t('scheduling.builder.dayOfMonth')} value={value.by.dayOfMonth} min={1} max={31} onChange={(dayOfMonth) => onChange({ ...value, by: { dayOfMonth } })} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-nth`}>{t('scheduling.builder.nth')}</Label>
                    <NativeSelect
                      id={`${id}-nth`}
                      value={String(value.by.nth)}
                      onChange={(e) => 'nth' in value.by && onChange({ ...value, by: { ...value.by, nth: Number(e.target.value) as (typeof NTHS)[number] } })}
                    >
                      {NTHS.map((n) => (
                        <option key={n} value={n}>
                          {t(`scheduling.nth.${n === -1 ? 'last' : n}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-wd`}>{t('scheduling.builder.weekday')}</Label>
                    <NativeSelect
                      id={`${id}-wd`}
                      value={String(value.by.weekday)}
                      onChange={(e) => 'nth' in value.by && onChange({ ...value, by: { ...value.by, weekday: Number(e.target.value) } })}
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {t(`scheduling.weekdays.${d}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
              )}
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            <DateField id={`${id}-start`} label={t('scheduling.builder.startDate')} value={value.startDate} onChange={(startDate) => startDate && onChange({ ...value, startDate })} />
            <DateField id={`${id}-end`} label={t('scheduling.builder.endDate')} value={value.endDate ?? ''} onChange={(end) => onChange({ ...value, endDate: end || null })} />
          </div>
          <DateList id={`${id}-skip`} label={t('scheduling.builder.skipDates')} values={value.skipDates} min={0} onChange={(skipDates) => onChange({ ...value, skipDates })} />
        </>
      )}
    </fieldset>
  );
}

interface TimingEditorProps {
  value: Timing;
  onChange: (t: Timing) => void;
  shifts: ShiftDto[];
  disabled?: boolean;
}

export function TimingEditor({ value, onChange, shifts, disabled }: TimingEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const max = SCHEDULING_LIMITS.maxExtendedWindowMinutes;
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-mode`}>{t('scheduling.builder.mode')}</Label>
        <NativeSelect id={`${id}-mode`} value={value.mode} onChange={(e) => onChange(defaultTiming(e.target.value as Timing['mode'], shifts))}>
          <option value="fixed">{t('scheduling.builder.modes.fixed')}</option>
          <option value="shift">{t('scheduling.builder.modes.shift')}</option>
        </NativeSelect>
      </div>
      {value.mode === 'fixed' ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-start`}>{t('scheduling.builder.startTime')}</Label>
            <Input id={`${id}-start`} type="time" value={value.startTime} onChange={(e) => e.target.value && onChange({ ...value, startTime: e.target.value })} />
          </div>
          <NumberField id={`${id}-due`} label={t('scheduling.builder.dueAfter')} value={value.dueAfterMinutes} min={1} max={max} onChange={(dueAfterMinutes) => onChange({ ...value, dueAfterMinutes })} />
          <NumberField id={`${id}-grace`} label={t('scheduling.builder.grace')} value={value.graceMinutes} min={0} max={max} onChange={(graceMinutes) => onChange({ ...value, graceMinutes })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-shift`}>{t('scheduling.builder.shift')}</Label>
            <NativeSelect id={`${id}-shift`} value={value.shiftId} onChange={(e) => onChange({ ...value, shiftId: e.target.value })}>
              <option value="">{t('scheduling.builder.chooseShift')}</option>
              {shifts
                .filter((s) => s.active || s.id === value.shiftId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startTime}–{s.endTime})
                  </option>
                ))}
            </NativeSelect>
          </div>
          <NumberField id={`${id}-grace`} label={t('scheduling.builder.grace')} value={value.graceMinutes} min={0} max={max} onChange={(graceMinutes) => onChange({ ...value, graceMinutes })} />
        </div>
      )}
    </fieldset>
  );
}
