import type { SiteDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { MoveSiteDialog } from './move-site-dialog';
import { useSites, useSiteTypes } from './queries';
import { SiteFormDialog } from './site-form-dialog';
import { SiteTree } from './site-tree';
import { SiteTypesPanel } from './site-types-panel';
import { buildTree } from './tree';

type DialogState = { kind: 'create'; parent: SiteDto | null } | { kind: 'edit'; site: SiteDto } | { kind: 'move'; site: SiteDto } | null;

export function SitesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('sites.manage');
  const sites = useSites();
  const types = useSiteTypes();
  const [dialog, setDialog] = useState<DialogState>(null);
  const tree = useMemo(() => buildTree(sites.data ?? []), [sites.data]);
  const typeName = (id: string) => types.data?.find((ty) => ty.id === id)?.name ?? '';
  const refresh = () => qc.invalidateQueries({ queryKey: ['sites'] });
  const close = () => setDialog(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('sites.title')}
        actions={canManage && <Button onClick={() => setDialog({ kind: 'create', parent: null })}>{t('sites.tree.addRoot')}</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('sites.tree.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {tree.length === 0 ? (
              <p className="text-muted-foreground">{sites.isLoading ? t('common.loading') : t('sites.tree.empty')}</p>
            ) : (
              <SiteTree
                nodes={tree}
                typeName={typeName}
                canManage={canManage}
                onAddChild={(n) => setDialog({ kind: 'create', parent: n })}
                onEdit={(n) => setDialog({ kind: 'edit', site: n })}
                onMove={(n) => setDialog({ kind: 'move', site: n })}
                onToggleActive={async (n) => {
                  try {
                    await api.sites.update(n.id, { active: !n.active });
                    await refresh();
                  } catch (e) {
                    toast.error(errorText(t, e));
                  }
                }}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('sites.types.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteTypesPanel types={types.data ?? []} canManage={canManage} />
          </CardContent>
        </Card>
      </div>

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <SiteFormDialog
          open
          onOpenChange={(o) => !o && close()}
          types={types.data ?? []}
          site={dialog.kind === 'edit' ? dialog.site : undefined}
          parent={dialog.kind === 'create' ? dialog.parent : undefined}
          onSubmit={async (v) => {
            const address = v.address || null;
            if (dialog.kind === 'edit') await api.sites.update(dialog.site.id, { name: v.name, typeId: v.typeId, address });
            else await api.sites.create({ parentId: dialog.parent?.id ?? null, typeId: v.typeId, name: v.name, address });
            await refresh();
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveSiteDialog
          open
          site={dialog.site}
          sites={sites.data ?? []}
          onOpenChange={(o) => !o && close()}
          onMove={async (parentId) => {
            try {
              await api.sites.move(dialog.site.id, { parentId });
              await refresh();
              close();
            } catch (e) {
              toast.error(errorText(t, e));
            }
          }}
        />
      )}
    </div>
  );
}
