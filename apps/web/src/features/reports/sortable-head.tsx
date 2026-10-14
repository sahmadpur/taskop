import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** A column header that sorts its table; `aria-sort` tells screen readers the current order. */
export function SortableHead({ label, dir, onSort, numeric }: { label: string; dir: 'asc' | 'desc' | null; onSort: () => void; numeric?: boolean }) {
  const { t } = useTranslation();
  return (
    <TableHead aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'} className={cn(numeric && 'text-right')}>
      <button type="button" onClick={onSort} title={t('reports.table.sort', { column: label })} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
        {label}
        <ArrowUpDown className="size-3" aria-hidden />
      </button>
    </TableHead>
  );
}
