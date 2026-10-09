import { TEMPLATE_CATEGORIES, type ChecklistStatus, type TemplateCategory } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { categoryLabel } from './labels';
import { NewChecklistDialog } from './new-checklist-dialog';
import { useChecklistPages } from './queries';
import { useWorkspace, WsLink } from './workspace';

export function ChecklistsPage() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ChecklistStatus | ''>('active');
  const [category, setCategory] = useState<TemplateCategory | ''>('');
  const q = useDeferredValue(search.trim());
  const pages = useChecklistPages({ q: q || undefined, status: status || undefined, category: category || undefined });
  const [creating, setCreating] = useState(false);
  const rows = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader title={t('checklists.title')} actions={ws.can.manage && <Button onClick={() => setCreating(true)}>{t('checklists.new')}</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input type="search" className="max-w-xs" placeholder={t('checklists.filters.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label={t('checklists.filters.status')} className="w-44" value={status} onChange={(e) => setStatus(e.target.value as ChecklistStatus | '')}>
          <option value="">{t('checklists.filters.allStatuses')}</option>
          <option value="active">{t('checklists.statuses.active')}</option>
          <option value="deactivated">{t('checklists.statuses.deactivated')}</option>
        </NativeSelect>
        <NativeSelect aria-label={t('checklists.filters.category')} className="w-52" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
          <option value="">{t('checklists.filters.allCategories')}</option>
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`checklists.categories.${c}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('checklists.name')}</TableHead>
            <TableHead>{t('checklists.category')}</TableHead>
            <TableHead>{t('checklists.version')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('checklists.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <WsLink to={`/checklists/${c.id}`}>{c.name}</WsLink>
                {c.description && <div className="text-muted-foreground text-xs">{c.description}</div>}
              </TableCell>
              <TableCell>{categoryLabel(t, c.category)}</TableCell>
              <TableCell className="flex items-center gap-2">
                {c.currentVersionNumber ? t('checklists.versionN', { n: c.currentVersionNumber }) : t('checklists.notPublished')}
                {c.draftRevision !== null && <Badge variant="outline">{t('checklists.draft')}</Badge>}
              </TableCell>
              <TableCell>
                <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{t(`checklists.statuses.${c.status}`)}</Badge>
              </TableCell>
              <TableCell>{formatDateTime(c.updatedAt, { locale: 'az', timeZone: ws.timeZone })}</TableCell>
            </TableRow>
          ))}
          {pages.isSuccess && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('checklists.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pages.hasNextPage && (
        <Button variant="outline" className="mt-3" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {t('common.loadMore')}
        </Button>
      )}
      {creating && <NewChecklistDialog open onOpenChange={setCreating} />}
    </div>
  );
}
