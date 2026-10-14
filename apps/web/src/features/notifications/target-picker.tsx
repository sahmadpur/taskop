import { MESSAGE_LIMITS } from '@taskop/contracts';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounced } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { cappedKinds, type MessageTargets, OPTION_CAPS, TARGET_KINDS, type TargetKind } from './message-form';
import { useMessageTargetOptions } from './queries';

interface Option {
  kind: TargetKind;
  id: string;
  name: string;
  detail: string | null;
}

const GROUP_LABEL: Record<TargetKind, string> = {
  users: 'notifications.messages.people',
  teams: 'notifications.messages.teams',
  sites: 'notifications.messages.sites',
};

interface Props {
  value: MessageTargets;
  onChange: (next: MessageTargets) => void;
}

/**
 * Spec §8: the message's people, teams and sites in one combobox (decision 1). Options come from
 * GET /notifications/messages/options (the sender's scope only); several of each kind, at most 200 per kind.
 */
export function TargetPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const label = t('notifications.messages.recipients');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 250);
  const options = useMessageTargetOptions(q, open);
  const inputRef = useRef<HTMLInputElement>(null);
  // Only a list that answers what is typed may be picked from with Enter (see AssigneePicker).
  const fresh = open && query.trim() === q && options.isSuccess && !options.isPlaceholderData;
  const needle = q.toLocaleLowerCase('az');
  const groups: Record<TargetKind, Option[]> = {
    users: (options.data?.users ?? []).map((u) => ({ kind: 'users', id: u.id, name: u.fullName, detail: u.jobTitle })),
    teams: (options.data?.teams ?? []).map((tm) => ({
      kind: 'teams',
      id: tm.id,
      name: tm.name,
      detail: t('notifications.messages.members', { count: tm.memberCount }),
    })),
    // The API returns every site in scope whatever q is; the search is applied here.
    sites: (options.data?.sites ?? [])
      .filter((s) => s.name.toLocaleLowerCase('az').includes(needle))
      .map((s) => ({ kind: 'sites', id: s.id, name: s.name, detail: null })),
  };
  const flat = TARGET_KINDS.flatMap((k) => groups[k]);
  // Lists the API cut at its cap are said to be partial rather than silently truncated.
  const capped = fresh && options.data ? cappedKinds(options.data) : [];
  const offset: Record<TargetKind, number> = { users: 0, teams: groups.users.length, sites: groups.users.length + groups.teams.length };
  const optionId = (i: number) => `${id}-option-${i}`;
  const isChosen = (o: Option) => value[o.kind].some((x) => x.id === o.id);
  const isFull = (k: TargetKind) => value[k].length >= MESSAGE_LIMITS.maxTargetsPerKind;

  const toggle = (o: Option) => {
    const list = value[o.kind];
    if (isChosen(o)) onChange({ ...value, [o.kind]: list.filter((x) => x.id !== o.id) });
    else if (!isFull(o.kind)) onChange({ ...value, [o.kind]: [...list, { id: o.id, name: o.name }] });
  };
  const remove = (kind: TargetKind, targetId: string) => onChange({ ...value, [kind]: value[kind].filter((x) => x.id !== targetId) });

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

  const chips = TARGET_KINDS.flatMap((k) => value[k].map((x) => ({ kind: k, ...x })));

  return (
    <div className="grid gap-1.5">
      <div className="relative grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={fresh && flat[active] ? optionId(active) : undefined}
          placeholder={t('notifications.messages.recipientsPlaceholder')}
          value={query}
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
              setActive((i) => Math.max(0, Math.min(flat.length - 1, i + step)));
            } else if (e.key === 'Enter') {
              // Never submits the surrounding form.
              e.preventDefault();
              if (fresh && flat[active]) toggle(flat[active]);
            }
          }}
        />
        {open && (
          <div
            // Clicks on headers and padding must not blur the input (which would close the list).
            onMouseDown={(e) => e.preventDefault()}
            className="bg-popover text-popover-foreground absolute top-full z-50 mt-1 grid max-h-72 w-full gap-2 overflow-y-auto rounded-md border p-1 shadow-md"
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
            {fresh && flat.length === 0 && (
              <p role="status" className="text-muted-foreground px-2 py-1.5 text-sm">
                {t('common.noResults')}
              </p>
            )}
            {capped.some((k) => k !== 'sites') && (
              <p role="status" className="text-muted-foreground px-2 py-1.5 text-xs">
                {t('notifications.messages.refine')}
              </p>
            )}
            {capped.includes('sites') && (
              <p role="status" className="text-muted-foreground px-2 py-1.5 text-xs">
                {t('notifications.messages.sitesCapped', { count: OPTION_CAPS.sites })}
              </p>
            )}
            <div id={`${id}-list`} role="listbox" aria-label={label} aria-multiselectable className="grid gap-2">
              {TARGET_KINDS.filter((k) => groups[k].length > 0).map((k) => (
                <div key={k} role="group" aria-label={t(GROUP_LABEL[k])}>
                  <p aria-hidden className="text-muted-foreground px-2 py-1 text-xs font-medium">
                    {t(GROUP_LABEL[k])}
                  </p>
                  {groups[k].map((o, j) => {
                    const i = offset[k] + j;
                    const chosen = isChosen(o);
                    const disabled = !chosen && isFull(k);
                    return (
                      <div
                        key={o.id}
                        id={optionId(i)}
                        role="option"
                        aria-label={o.name}
                        aria-selected={chosen}
                        aria-disabled={disabled || undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggle(o)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm',
                          i === active ? 'bg-accent' : 'hover:bg-accent/60',
                          disabled && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={cn('size-3.5 rounded-sm border', chosen && 'border-primary bg-primary')} />
                          {o.name}
                        </span>
                        {o.detail && <span className="text-muted-foreground text-xs">{o.detail}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {chips.length > 0 && (
        <ul aria-label={t('notifications.messages.chosen')} className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={`${c.kind}-${c.id}`} className="bg-secondary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-sm">
              {c.name}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('notifications.messages.remove', { name: c.name })} onClick={() => remove(c.kind, c.id)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {TARGET_KINDS.some(isFull) && (
        <p className="text-muted-foreground text-xs">{t('notifications.messages.targetLimit', { count: MESSAGE_LIMITS.maxTargetsPerKind })}</p>
      )}
    </div>
  );
}
