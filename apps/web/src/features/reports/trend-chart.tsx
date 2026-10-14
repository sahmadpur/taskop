import type { ReportTrendDay } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatLocalDate } from '@/features/scheduling/labels';
import { useMe } from '@/lib/session';
import { percentText } from './labels';

/** Theme tokens from src/styles.css, so light and dark mode both apply (decision 8). */
const COLOR = { due: 'var(--chart-2)', completed: 'var(--primary)', grid: 'var(--border)', axis: 'var(--muted-foreground)' } as const;
const TICK = { fontSize: 12, fill: COLOR.axis };
const TOOLTIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)' };
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

/**
 * Spec §6.1: due vs completed per day, and the completion %. Two charts on one time axis (synced hover), not one chart
 * with two y-scales. The charts are decoration for sighted users; the hidden table carries the same numbers.
 */
export function TrendChart({ trend }: { trend: readonly ReportTrendDay[] }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const titleId = useId();
  if (trend.length < 2) return null;

  const short = new Intl.DateTimeFormat(intlLocale(tenant.locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const tick = (date: string) => short.format(new Date(`${date}T00:00:00Z`));
  const day = (date: unknown) => formatLocalDate(String(date), tenant.locale);
  const data = trend.map((d) => ({ ...d }));
  const label = { due: t('reports.counts.due'), completed: t('reports.counts.completed'), percent: t('reports.measures.completionPercent') };

  return (
    <figure aria-labelledby={titleId} className="grid gap-2 rounded-lg border p-4">
      <figcaption id={titleId} className="font-medium">
        {t('reports.trend')}
      </figcaption>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="report-trend" margin={MARGIN} barGap={2} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke={COLOR.grid} />
            <XAxis dataKey="date" tickFormatter={tick} tick={TICK} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={32} />
            <Tooltip labelFormatter={day} cursor={{ fill: 'var(--muted)' }} contentStyle={TOOLTIP} />
            <Legend />
            <Bar dataKey="due" name={label.due} fill={COLOR.due} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="completed" name={label.completed} fill={COLOR.completed} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground text-xs" aria-hidden>
        {label.percent}
      </p>
      <div className="h-28" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="report-trend" margin={MARGIN} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke={COLOR.grid} />
            <XAxis dataKey="date" tickFormatter={tick} tick={TICK} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} unit="%" tick={TICK} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              labelFormatter={day}
              formatter={(v) => percentText(t, typeof v === 'number' ? v : null, tenant.locale)}
              contentStyle={TOOLTIP}
            />
            <Line dataKey="completionPercent" name={label.percent} stroke={COLOR.completed} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{t('reports.chart.table')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('reports.columns.date')}</th>
            <th scope="col">{label.due}</th>
            <th scope="col">{label.completed}</th>
            <th scope="col">{label.percent}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((d) => (
            <tr key={d.date}>
              <td>{formatLocalDate(d.date, tenant.locale)}</td>
              <td>{d.due}</td>
              <td>{d.completed}</td>
              <td>{percentText(t, d.completionPercent, tenant.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
