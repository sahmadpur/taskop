import { addDays, SCHEDULING_LIMITS } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { formatLocalDate, useTenantToday } from './labels';
import { useRoster } from './queries';
import { parseKey, rowKey, toggleKey, weekDates, weekStartOf } from './roster-grid';

export function RosterPage({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = useTenantToday();
  const canManage = useCan('shifts.manage');
  const sites = useSites();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(initialDate ?? today));
  const days = weekDates(weekStart);
  const to = days[6]!;
  const roster = useRoster(siteId, weekStart, to);
  const saved = useMemo(() => new Set((roster.data?.rows ?? []).map(rowKey)), [roster.data]);
  // A draft belongs to one site and week; switching either discards it.
  const scope = `${siteId ?? ''}|${weekStart}`;
  const [draftState, setDraftState] = useState<{ scope: string; keys: Set<string> } | null>(null);
  // Switching site or week discards the draft for good (reset during render).
  if (draftState && draftState.scope !== scope) setDraftState(null);
  const draft = draftState?.scope === scope ? draftState.keys : null;
  const setDraft = (keys: Set<string> | null) => setDraftState(keys ? { scope, keys } : null);
  const [copying, setCopying] = useState(false);
  const [weeks, setWeeks] = useState(1);
  const current = draft ?? saved;
  // Ticking and unticking the same cell is not a change.
  const dirty = draft !== null && (draft.size !== saved.size || [...draft].some((k) => !saved.has(k)));

  // Inactive shifts stay visible while a row in this week still uses them.
  const shifts = (roster.data?.shifts ?? []).filter(
    (s) => s.active || [...saved, ...current].some((k) => parseKey(k).shiftId === s.id),
  );
  // People no longer at the site (left, deactivated) stay visible while a row in this week still names them,
  // so those rows can be unticked; they cannot be given new ones.
  const people = useMemo(() => {
    const listed = roster.data?.users ?? [];
    const known = new Set(listed.map((u) => u.id));
    const former = [...new Set([...saved, ...current].map((k) => parseKey(k).userId))].filter((id) => !known.has(id));
    return [
      ...listed.map((u) => ({ ...u, former: false })),
      ...former.map((id) => ({ id, fullName: t('scheduling.roster.formerPerson'), former: true })),
    ];
  }, [roster.data, saved, current, t]);

  const save = async () => {
    try {
      await api.roster.put({ siteId: siteId!, from: weekStart, to, rows: [...current].map(parseKey) });
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['roster'] });
      toast.success(t('scheduling.roster.saved'));
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  const copy = async () => {
    try {
      const targetWeekStarts = Array.from({ length: weeks }, (_, i) => addDays(weekStart, 7 * (i + 1)));
      const result = await api.roster.copy({ siteId: siteId!, sourceWeekStart: weekStart, targetWeekStarts });
      setCopying(false);
      await qc.invalidateQueries({ queryKey: ['roster'] });
      toast.success(t('scheduling.roster.copied', { count: result.rowCount }));
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t('scheduling.roster.title')}
        actions={
          canManage &&
          siteId && (
            <>
              <Button variant="outline" disabled={dirty || !roster.data} onClick={() => setCopying(true)}>
                {t('scheduling.roster.copy')}
              </Button>
              <Button disabled={!dirty} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="roster-site">{t('scheduling.roster.site')}</Label>
          <NativeSelect
            id="roster-site"
            value={siteId ?? ''}
            onChange={(e) => setSiteId(e.target.value || null)}
            disabled={sites.isPending}
            className="w-64"
          >
            <option value="">{t('scheduling.roster.chooseSite')}</option>
            {(sites.data ?? [])
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </NativeSelect>
          {sites.isError && <p className="text-destructive text-sm">{errorText(t, sites.error)}</p>}
        </div>
        <Button variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          {t('scheduling.roster.prevWeek')}
        </Button>
        <span className="text-sm">
          {formatLocalDate(weekStart)} – {formatLocalDate(to)}
        </span>
        <Button variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          {t('scheduling.roster.nextWeek')}
        </Button>
        {dirty && <span className="text-sm text-amber-700">{t('scheduling.roster.unsaved')}</span>}
      </div>

      {siteId && roster.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {siteId && roster.isError && <p className="text-destructive text-sm">{errorText(t, roster.error)}</p>}
      {siteId && roster.data && people.length === 0 && (
        <p className="text-muted-foreground">{t('scheduling.roster.noPeople')}</p>
      )}
      {siteId && roster.data && people.length > 0 && shifts.length === 0 && (
        <p className="text-muted-foreground">{t('scheduling.roster.noShifts')}</p>
      )}
      {siteId && people.length > 0 && shifts.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('scheduling.roster.person')}</TableHead>
              {days.map((d) => (
                <TableHead key={d}>{formatLocalDate(d)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.fullName}</TableCell>
                {days.map((d) => (
                  <TableCell key={d}>
                    <div className="grid gap-1">
                      {shifts.map((s) => {
                        const key = rowKey({ userId: u.id, shiftId: s.id, date: d });
                        return (
                          <label key={s.id} className="flex items-center gap-1 text-xs">
                            <Checkbox
                              aria-label={t('scheduling.roster.cellLabel', {
                                shift: s.name,
                                person: u.fullName,
                                date: d,
                              })}
                              checked={current.has(key)}
                              disabled={!canManage || (u.former && !current.has(key))}
                              onCheckedChange={(c) => setDraft(toggleKey(current, key, c === true))}
                            />
                            {s.name}
                          </label>
                        );
                      })}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={copying} onOpenChange={setCopying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('scheduling.roster.copyTitle')}</DialogTitle>
            <DialogDescription>{t('scheduling.roster.copyHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="copy-weeks">{t('scheduling.roster.copyWeeks')}</Label>
            <Input
              id="copy-weeks"
              type="number"
              min={1}
              max={SCHEDULING_LIMITS.copyMaxWeeks}
              value={weeks}
              onChange={(e) =>
                setWeeks(Math.min(SCHEDULING_LIMITS.copyMaxWeeks, Math.max(1, Number(e.target.value) || 1)))
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopying(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void copy()}>{t('scheduling.roster.copyAction')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
