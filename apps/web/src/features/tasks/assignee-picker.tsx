import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounced } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { type AssigneeChoice, sameChoice } from './labels';
import { useTaskAssignees } from './queries';

interface Props {
  label: string;
  value: AssigneeChoice | null;
  onChange: (choice: AssigneeChoice | null) => void;
  clearable?: boolean;
}

/** Person-or-team combobox (spec §8): GET /tasks/assignees, people and teams in two groups, searched by name. */
export function AssigneePicker({ label, value, onChange, clearable = false }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 250);
  const options = useTaskAssignees(q, open);
  const users = options.data?.users ?? [];
  const teams = options.data?.teams ?? [];
  const choices: AssigneeChoice[] = [
    ...users.map((u) => ({ type: 'user' as const, id: u.id, name: u.fullName })),
    ...teams.map((tm) => ({ type: 'team' as const, id: tm.id, name: tm.name })),
  ];
  const details = [...users.map((u) => u.jobTitle), ...teams.map((tm) => t('tasks.picker.members', { count: tm.memberCount }))];
  const optionId = (i: number) => `${id}-option-${i}`;
  // The search may no longer list the current choice; keep it identifiable (and selectable) at the top.
  const pinned = value && !choices.some((c) => sameChoice(c, value)) ? value : null;

  const pick = (c: AssigneeChoice) => {
    onChange(c);
    setQuery('');
    setOpen(false);
  };

  const option = (c: AssigneeChoice, i: number, domId = optionId(i)) => (
    <div
      key={`${c.type}-${c.id}`}
      id={domId}
      role="option"
      aria-label={c.name}
      aria-selected={sameChoice(c, value)}
      // Keep the focus in the input, so its blur does not close the list before the click lands.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(c)}
      className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm', i === active ? 'bg-accent' : 'hover:bg-accent/60')}
    >
      <span>{c.name}</span>
      {details[i] && <span className="text-muted-foreground text-xs">{details[i]}</span>}
    </div>
  );

  return (
    <div className="relative grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && choices[active] ? optionId(active) : undefined}
          placeholder={t('tasks.picker.placeholder')}
          value={open ? query : (value?.name ?? '')}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => Math.max(0, Math.min(choices.length - 1, i + step)));
            } else if (e.key === 'Enter' && open && choices[active]) {
              e.preventDefault();
              pick(choices[active]);
            }
          }}
        />
        {clearable && value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t('tasks.picker.clear')}
          </Button>
        )}
      </div>
      {open && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="bg-popover text-popover-foreground absolute top-full z-50 mt-1 grid max-h-64 w-full gap-2 overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {options.isPending && <p className="text-muted-foreground px-2 py-1.5 text-sm">{t('common.loading')}</p>}
          {options.isError && <p className="text-destructive px-2 py-1.5 text-sm">{errorText(t, options.error)}</p>}
          {options.isSuccess && choices.length === 0 && <p className="text-muted-foreground px-2 py-1.5 text-sm">{t('common.noResults')}</p>}
          {pinned && option(pinned, -1, `${id}-option-selected`)}
          {users.length > 0 && (
            <div role="group" aria-label={t('tasks.picker.people')}>
              <p aria-hidden className="text-muted-foreground px-2 py-1 text-xs font-medium">
                {t('tasks.picker.people')}
              </p>
              {choices.slice(0, users.length).map((c, i) => option(c, i))}
            </div>
          )}
          {teams.length > 0 && (
            <div role="group" aria-label={t('tasks.picker.teams')}>
              <p aria-hidden className="text-muted-foreground px-2 py-1 text-xs font-medium">
                {t('tasks.picker.teams')}
              </p>
              {choices.slice(users.length).map((c, i) => option(c, users.length + i))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
