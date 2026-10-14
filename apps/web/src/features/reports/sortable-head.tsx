import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** A column header that sorts its table; `aria-sort` tells screen readers the current order. */
export function SortableHead({ label, dir, onSort, numeric }: { label: string; dir: 'asc' | 'desc' | null; onSort: () => void; numeric?: boolean }) {
  const { t } = useTranslation();
  const action = t('reports.table.sort', { column: label });
  // The header carries the same name as its button: name-from-content does not read a nested button's aria-label.
  return (
    <TableHead aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'} aria-label={action} className={cn(numeric && 'text-right')}>
      <button type="button" onClick={onSort} aria-label={action} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
        {label}
        <ArrowUpDown className="size-3" aria-hidden />
      </button>
    </TableHead>
  );
}
