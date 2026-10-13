import { useEffect, useId, useRef, useState } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);
  // The list answers what is typed only once the debounce has caught up and that search has arrived; before that
  // (kept-over rows from the previous search) Enter and the active descendant must not point at a stale row.
  const fresh = open && query.trim() === q && options.isSuccess && !options.isPlaceholderData;
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

  // Escape closes only the list: a window-capture listener runs before a parent Radix Dialog's own Escape handling.
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== inputRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      setQuery('');
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const pick = (c: AssigneeChoice) => {
    onChange(c);
    setQuery('');
    setActive(0);
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
          ref={inputRef}
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={fresh && choices[active] ? optionId(active) : undefined}
          placeholder={t('tasks.picker.placeholder')}
          value={open ? query : (value?.name ?? '')}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setQuery('');
            setActive(0);
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
              if (!fresh) return;
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => Math.max(0, Math.min(choices.length - 1, i + step)));
            } else if (e.key === 'Enter' && fresh && choices[active]) {
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
          // Clicks on headers and padding must not blur the input (which would close and reset the list).
          onMouseDown={(e) => e.preventDefault()}
          className="bg-popover text-popover-foreground absolute top-full z-50 mt-1 grid max-h-64 w-full gap-2 overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {options.isPending && (
            <p role="status" className="text-muted-foreground px-2 py-1.5 text-sm">
              {t('common.loading')}
            </p>
          )}
          {options.isError && (
            <p role="status" className="text-destructive px-2 py-1.5 text-sm">
              {errorText(t, options.error)}
            </p>
          )}
          {fresh && choices.length === 0 && (
            <p role="status" className="text-muted-foreground px-2 py-1.5 text-sm">
              {t('common.noResults')}
            </p>
          )}
          <div id={`${id}-list`} role="listbox" aria-label={label} className="grid gap-2">
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
        </div>
      )}
    </div>
  );
}
