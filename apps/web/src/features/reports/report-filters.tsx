import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatLocalDate } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { useCan } from '@/lib/session';
import { checklistOptions, employeeOptions, siteOptions } from './labels';
import { useEmployeeOptions, useReportChecklistOptions } from './queries';
import { cleanSearch, DEFAULT_PERIOD, FILTER_ISSUE_KEYS, PERIOD_CHOICES, type PeriodChoice, type ReportSearch, resolveReportFilters, withPeriod } from './search';
import { useLocale } from '@/lib/i18n';

/**
 * The filter bar of the dashboard and the Reports page (spec §6.1). Controlled: the page keeps `value` in the URL.
 * Presets resolve from `today`, the tenant's today. The site picker includes the subtree (the API's rule).
 */
export function ReportFilters({ value, today, onChange }: { value: ReportSearch; today: string; onChange: (next: ReportSearch) => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const canSeeSites = useCan('sites.view');
  const canSeeChecklists = useCan('checklists.view');
  const sites = useSites(canSeeSites);
  const checklists = useReportChecklistOptions(canSeeChecklists);
  const resolved = resolveReportFilters(value, today);
  const employees = useEmployeeOptions(resolved.ok ? resolved.filters : null);
  const fromId = useId();
  const toId = useId();
  const inactiveId = useId();

  const period = value.period ?? DEFAULT_PERIOD;
  const showInactive = value.inactive === true;
  const set = (patch: Partial<ReportSearch>) => onChange(cleanSearch({ ...value, ...patch }));
  // The default period is absent from the URL (spec §6.1), so choosing Today drops `period` instead of writing it.
  const choosePeriod = (choice: PeriodChoice) => {
    const next = withPeriod(value, choice, today);
    onChange(cleanSearch(next.period === DEFAULT_PERIOD ? { ...next, period: undefined } : next));
  };
  const marked = (label: string, active: boolean) => (active ? label : `${label} (${t('reports.inactive')})`);

  const siteList = siteOptions(sites.data ?? [], showInactive, value.siteId);
  const people = employeeOptions(employees.data ?? [], showInactive, value.userId);
  const lists = checklistOptions(checklists.data ?? [], showInactive, value.checklistId);
  // A selected id no list contains still shows as selected (decision 5), never as "all".
  const unknownSite = Boolean(value.siteId) && !siteList.some((s) => s.id === value.siteId);
  const unknownPerson = Boolean(value.userId) && !people.some((p) => p.id === value.userId);
  const unknownList = Boolean(value.checklistId) && !lists.some((c) => c.id === value.checklistId);

  let range: string | null = null;
  if (resolved.ok) {
    const { from, to } = resolved.filters;
    range = from === to ? formatLocalDate(from, locale) : t('reports.range.label', { from: formatLocalDate(from, locale), to: formatLocalDate(to, locale) });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <NativeSelect
        aria-label={t('reports.filters.period')}
        value={period}
        onChange={(e) => choosePeriod(e.target.value as PeriodChoice)}
        className="w-44"
      >
        {PERIOD_CHOICES.map((p) => (
          <option key={p} value={p}>
            {t(`reports.periods.${p}`)}
          </option>
        ))}
      </NativeSelect>
      {period === 'custom' && (
        <>
          <div className="grid gap-1">
            <Label htmlFor={fromId}>{t('reports.filters.from')}</Label>
            <Input id={fromId} type="date" value={value.from ?? ''} onChange={(e) => set({ from: e.target.value })} className="w-44" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={toId}>{t('reports.filters.to')}</Label>
            <Input id={toId} type="date" value={value.to ?? ''} onChange={(e) => set({ to: e.target.value })} className="w-44" />
          </div>
        </>
      )}
      {canSeeSites && (
        <NativeSelect aria-label={t('reports.filters.site')} value={value.siteId ?? ''} onChange={(e) => set({ siteId: e.target.value })} className="w-56">
          <option value="">{t('reports.filters.allSites')}</option>
          {siteList.map((s) => (
            <option key={s.id} value={s.id}>
              {marked(indentedName(s), s.active)}
            </option>
          ))}
          {unknownSite && <option value={value.siteId}>{t('reports.picker.unknown')}</option>}
        </NativeSelect>
      )}
      <NativeSelect aria-label={t('reports.filters.employee')} value={value.userId ?? ''} onChange={(e) => set({ userId: e.target.value })} className="w-56">
        <option value="">{t('reports.filters.allEmployees')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {marked(p.name, p.active)}
          </option>
        ))}
        {unknownPerson && <option value={value.userId}>{t('reports.picker.unknownEmployee')}</option>}
      </NativeSelect>
      {canSeeChecklists && (
        <NativeSelect aria-label={t('reports.filters.checklist')} value={value.checklistId ?? ''} onChange={(e) => set({ checklistId: e.target.value })} className="w-56">
          <option value="">{t('reports.filters.allChecklists')}</option>
          {lists.map((c) => (
            <option key={c.id} value={c.id}>
              {marked(c.name, c.status === 'active')}
            </option>
          ))}
          {unknownList && <option value={value.checklistId}>{t('reports.picker.unknown')}</option>}
        </NativeSelect>
      )}
      <div className="flex h-9 items-center gap-2">
        <Checkbox id={inactiveId} checked={showInactive} onCheckedChange={(c) => set({ inactive: c === true ? true : undefined })} />
        <Label htmlFor={inactiveId}>{t('reports.filters.showInactive')}</Label>
      </div>
      {resolved.ok ? (
        <p className="text-muted-foreground flex h-9 items-center text-sm">{range}</p>
      ) : (
        <p role="alert" className="text-destructive flex h-9 items-center text-sm">
          {t(FILTER_ISSUE_KEYS[resolved.issue])}
        </p>
      )}
    </div>
  );
}
