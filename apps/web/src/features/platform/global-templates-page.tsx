import { formatDateTime } from '@taskop/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DetailsDialog } from '@/features/checklists/checklist-dialogs';
import { categoryLabel } from '@/features/checklists/labels';
import { errorText } from '@/lib/errors';
import { platformApi } from './platform-session';

export function GlobalTemplatesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({
    queryKey: ['platform', 'global-templates'],
    queryFn: () => platformApi.globalTemplates.list(),
  });
  const [creating, setCreating] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['platform', 'global-templates'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  const open = (id: string) => void navigate({ to: `/platform/templates/${id}` as '/platform/tenants' });

  return (
    <div>
      <PageHeader
        title={t('checklists.templates.taskop')}
        actions={<Button onClick={() => setCreating(true)}>{t('checklists.templates.new')}</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('checklists.name')}</TableHead>
            <TableHead>{t('checklists.category')}</TableHead>
            <TableHead>{t('checklists.templates.sortOrder')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('checklists.updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(templates.data ?? []).map((g) => (
            <TableRow key={g.id}>
              <TableCell className="font-medium">
                {g.name}
                <div className="text-muted-foreground text-xs">
                  {t('checklists.templates.items', { count: g.itemCount })}
                </div>
              </TableCell>
              <TableCell>{categoryLabel(t, g.category)}</TableCell>
              <TableCell>{g.sortOrder}</TableCell>
              <TableCell>
                <Badge variant={g.published ? 'default' : 'secondary'}>
                  {g.published ? t('checklists.templates.published') : t('checklists.templates.unpublished')}
                </Badge>
              </TableCell>
              <TableCell>{formatDateTime(g.updatedAt, { locale: 'az', timeZone: 'Asia/Baku' })}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => open(g.id)}>
                    {t('checklists.templates.editTemplate')}
                  </Button>
                  {g.published ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void act(() => platformApi.globalTemplates.unpublish(g.id))}
                    >
                      {t('checklists.templates.unpublish')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void act(() => platformApi.globalTemplates.publish(g.id))}
                    >
                      {t('checklists.templates.publish')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {creating && (
        <DetailsDialog
          title={t('checklists.templates.new')}
          submitLabel={t('common.create')}
          categoryRequired
          initial={{ name: '', description: null, category: null }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const created = await platformApi.globalTemplates.create({
              name: v.name,
              category: v.category!,
              ...(v.description ? { description: v.description } : {}),
            });
            open(created.id);
          }}
        />
      )}
    </div>
  );
}
