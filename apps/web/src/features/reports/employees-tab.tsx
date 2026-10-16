import type { EmployeeReportRow, ReportFilters } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { errorText } from '@/lib/errors';
import { ComparisonTable } from './comparison-table';
import { useEmployeeReport } from './queries';
import { LoadingState, EmptyState } from '@/components/states';

const isUnassigned = (r: EmployeeReportRow) => r.userId === null;

/**
 * Spec §6.2 "Employees" (§3.3 attribution): the Unassigned row last and not clickable (decision 11), and the note
 * that the Planned column may add up to more than the sites table.
 */
export function EmployeesTab({ filters, onDrill }: { filters: ReportFilters; onDrill: (userId: string) => void }) {
  const { t } = useTranslation();
  const people = useEmployeeReport(filters);
  if (people.error) return <p className="text-destructive">{errorText(t, people.error)}</p>;
  if (!people.data) return <LoadingState />;
  if (people.data.length === 0) return <EmptyState title={t('reports.empty')} />;
  return (
    <div className="grid gap-2">
      <ComparisonTable
        rows={people.data}
        nameLabel={t('reports.columns.employee')}
        rowKey={(r) => r.userId ?? 'unassigned'}
        pinLast={isUnassigned}
        renderName={(r) =>
          r.userId === null ? (
            <span className="text-muted-foreground italic">{r.name}</span>
          ) : (
            <span className="flex items-center gap-2">
              <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => onDrill(r.userId!)}>
                {r.name}
              </button>
              {!r.active && <Badge variant="outline">{t('reports.inactive')}</Badge>}
            </span>
          )
        }
      />
      <p className="text-muted-foreground text-sm">{t('reports.employees.overCountNote')}</p>
    </div>
  );
}
