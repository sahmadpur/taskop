import type { ReportTrendDay } from '@taskop/contracts';
import { formatShortDate } from '@taskop/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatLocalDate } from '@/features/scheduling/labels';
import { percentText } from './labels';
import { useLocale } from '@/lib/i18n';

/** Theme tokens from src/styles.css, so light and dark mode both apply (decision 8). */
const COLOR = { due: 'var(--tp-line-strong)', dueStroke: 'none', completed: 'var(--tp-primary)', percent: 'var(--tp-saffron)', grid: 'var(--tp-line)', axis: 'var(--tp-ink2)' } as const;
const TICK = { fontSize: 12, fill: COLOR.axis };
const TOOLTIP = { background: 'var(--tp-surface-raised)', border: '1px solid var(--tp-line)', borderRadius: 10, color: 'var(--tp-ink)', boxShadow: 'var(--tp-shadow-raised)' };
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

/**
 * Spec §6.1: due vs completed per day, and the completion %. Two charts on one time axis (synced hover), not one chart
 * with two y-scales. The charts are decoration for sighted users; the hidden table carries the same numbers.
 */
export function TrendChart({ trend }: { trend: readonly ReportTrendDay[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const titleId = useId();
  if (trend.length < 2) return null;

  const tick = (date: string) => formatShortDate(date, locale);
  const day = (date: unknown) => formatLocalDate(String(date), locale);
  const data = trend.map((d) => ({ ...d }));
  const label = { due: t('reports.counts.due'), completed: t('reports.counts.completed'), percent: t('reports.measures.completionPercent') };

  return (
    <figure aria-labelledby={titleId} className="bg-card shadow-card grid gap-2 rounded-xl p-5">
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
            <Bar dataKey="due" name={label.due} fill={COLOR.due} stroke={COLOR.dueStroke} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
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
              formatter={(v) => percentText(t, typeof v === 'number' ? v : null, locale)}
              contentStyle={TOOLTIP}
            />
            <Line dataKey="completionPercent" name={label.percent} stroke={COLOR.percent} strokeWidth={2.5} dot={{ r: 3, fill: COLOR.percent, strokeWidth: 0 }} isAnimationActive={false} />
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
              <td>{formatLocalDate(d.date, locale)}</td>
              <td>{d.due}</td>
              <td>{d.completed}</td>
              <td>{percentText(t, d.completionPercent, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
