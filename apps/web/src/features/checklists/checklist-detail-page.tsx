import type { ChecklistVersionSummary } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { DetailsDialog } from './checklist-dialogs';
import { categoryLabel } from './labels';
import { NewChecklistDialog } from './new-checklist-dialog';
import { useChecklist } from './queries';
import { useWorkspace, WsLink } from './workspace';

export function ChecklistDetailPage({ checklistId }: { checklistId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const detail = useChecklist(checklistId);
  const [dialog, setDialog] = useState<null | 'details' | 'copy' | { saveAsTemplate: ChecklistVersionSummary }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [ws.scope, 'checklists'] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  if (detail.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (detail.error) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  const c = detail.data;
  const active = c.status === 'active';
  const hasDraft = c.draftRevision !== null;
  const editable = ws.can.manage && active;

  const openEditor = () =>
    act(async () => {
      if (!hasDraft) await ws.checklists.startDraft(checklistId);
      ws.go(`/checklists/${checklistId}/draft`);
    });

  return (
    <div className="grid gap-4">
      <PageHeader
        title={c.name}
        actions={
          <>
            {editable && <Button onClick={() => void openEditor()}>{hasDraft ? t('checklists.detail.continueDraft') : t('checklists.detail.edit')}</Button>}
            {ws.can.manage && c.currentVersionId && (
              <Button variant="outline" onClick={() => setDialog('copy')}>
                {t('checklists.detail.copy')}
              </Button>
            )}
            {editable && (
              <Button variant="outline" onClick={() => setDialog('details')}>
                {t('checklists.detail.editDetails')}
              </Button>
            )}
            {editable && hasDraft && (
              <ConfirmButton
                label={t('checklists.detail.discardDraft')}
                title={t('checklists.detail.discardDraft')}
                description={t('checklists.detail.confirmDiscard')}
                onConfirm={() => act(() => ws.checklists.discardDraft(checklistId))}
              />
            )}
            {ws.can.manage &&
              (active ? (
                <ConfirmButton
                  variant="destructive"
                  label={t('common.deactivate')}
                  title={t('common.deactivate')}
                  description={t('checklists.detail.confirmDeactivate', { name: c.name })}
                  onConfirm={() => act(() => ws.checklists.deactivate(checklistId))}
                />
              ) : (
                <Button variant="outline" onClick={() => void act(() => ws.checklists.reactivate(checklistId))}>
                  {t('common.reactivate')}
                </Button>
              ))}
          </>
        }
      />
      {!active && (
        <Alert>
          <AlertDescription>{t('checklists.detail.deactivatedBanner')}</AlertDescription>
        </Alert>
      )}
      <div className="text-muted-foreground flex flex-wrap gap-3 text-sm">
        <span>{categoryLabel(t, c.category)}</span>
        {c.source && <span>{t(`checklists.detail.source.${c.source.kind}`)}</span>}
        {c.description && <span>{c.description}</span>}
      </div>
      <h2 className="text-lg font-semibold">{t('checklists.detail.versions')}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('checklists.version')}</TableHead>
            <TableHead>{t('checklists.detail.publishedAt')}</TableHead>
            <TableHead>{t('checklists.detail.publishedBy')}</TableHead>
            <TableHead>{t('checklists.detail.changeNote')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {c.versions.map((v) => (
            <TableRow key={v.id}>
              <TableCell>{v.number ? t('checklists.versionN', { n: v.number }) : <Badge variant="outline">{t('checklists.draft')}</Badge>}</TableCell>
              <TableCell>{v.publishedAt ? formatDateTime(v.publishedAt, { locale: 'az', timeZone: ws.timeZone }) : '—'}</TableCell>
              <TableCell>{v.publishedBy ? (v.publishedBy.kind === 'platform' ? t('checklists.detail.taskop') : v.publishedBy.name) : '—'}</TableCell>
              <TableCell>{v.changeNote ?? '—'}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <WsLink to={v.state === 'draft' ? `/checklists/${c.id}/draft` : `/checklists/${c.id}/versions/${v.id}`} className="px-2 py-1 text-sm hover:underline">
                    {t('checklists.detail.open')}
                  </WsLink>
                  {v.state === 'published' && editable && !hasDraft && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(async () => {
                          await ws.checklists.startDraft(checklistId, { fromVersionId: v.id });
                          ws.go(`/checklists/${checklistId}/draft`);
                        })
                      }
                    >
                      {t('checklists.detail.restore')}
                    </Button>
                  )}
                  {v.state === 'published' && ws.can.templates && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ saveAsTemplate: v })}>
                      {t('checklists.detail.saveAsTemplate')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {dialog === 'details' && (
        <DetailsDialog
          title={t('checklists.detail.editDetails')}
          submitLabel={t('common.save')}
          initial={{ name: c.name, description: c.description, category: c.category }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            await ws.checklists.update(checklistId, v);
            await refresh();
          }}
        />
      )}
      {dialog === 'copy' && <NewChecklistDialog open initialMode="copy" copyFrom={{ id: c.id, name: c.name }} onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog && typeof dialog === 'object' && (
        <DetailsDialog
          title={t('checklists.saveAsTemplate.title')}
          submitLabel={t('common.save')}
          categoryRequired
          initial={{ name: c.name, description: null, category: null }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            await ws.checklists.saveAsTemplate(checklistId, dialog.saveAsTemplate.id, { name: v.name, category: v.category!, description: v.description });
            toast.success(t('checklists.saveAsTemplate.done'));
          }}
        />
      )}
    </div>
  );
}
