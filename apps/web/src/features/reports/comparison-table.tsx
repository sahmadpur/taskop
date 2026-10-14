import type { RunCounts } from '@taskop/contracts';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { useMe } from '@/lib/session';
import { nextSort, percentText, type SortState, sortRows } from './labels';
import { SortableHead } from './sortable-head';

export type ComparisonKey = 'name' | 'planned' | 'completed' | 'overdue' | 'partial' | 'missed' | 'withProblems' | 'completionPercent' | 'averageScore';

/** Spec §5.3 columns of the site and employee comparisons. */
export const COMPARISON_COLUMNS: readonly ComparisonKey[] = ['name', 'planned', 'completed', 'overdue', 'partial', 'missed', 'withProblems', 'completionPercent', 'averageScore'];

const COUNT_COLUMNS = ['planned', 'completed', 'overdue', 'partial', 'missed', 'withProblems'] as const;

interface ComparisonRow extends RunCounts {
  name: string;
  active: boolean;
  completionPercent: number | null;
  averageScore: number | null;
}

/** A client-side sortable comparison (decision 12); `pinLast` rows (the Unassigned row) stay at the bottom. */
export function ComparisonTable<T extends ComparisonRow>({
  rows,
  nameLabel,
  rowKey,
  renderName,
  pinLast,
}: {
  rows: readonly T[];
  nameLabel: string;
  rowKey: (row: T) => string;
  renderName: (row: T) => ReactNode;
  pinLast?: (row: T) => boolean;
}) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const [sort, setSort] = useState<SortState<ComparisonKey> | null>(null);
  const label = (k: ComparisonKey) =>
    k === 'name' ? nameLabel : k === 'completionPercent' || k === 'averageScore' ? t(`reports.measures.${k}`) : t(`reports.counts.${k}`);
  const sorted = sortRows(rows, sort, pinLast);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COMPARISON_COLUMNS.map((k) => (
            <SortableHead key={k} label={label(k)} dir={sort?.key === k ? sort.dir : null} numeric={k !== 'name'} onSort={() => setSort((s) => nextSort(s, k))} />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={rowKey(r)}>
            <TableCell>{renderName(r)}</TableCell>
            {COUNT_COLUMNS.map((k) => (
              <TableCell key={k} className="text-right tabular-nums">
                {r[k]}
              </TableCell>
            ))}
            <TableCell className="text-right tabular-nums">{percentText(t, r.completionPercent, tenant.locale)}</TableCell>
            <TableCell className="text-right tabular-nums">{percentText(t, r.averageScore, tenant.locale)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
