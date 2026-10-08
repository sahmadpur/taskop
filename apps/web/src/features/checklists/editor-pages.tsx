import { ApiError } from '@taskop/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { Builder } from './builder/builder';
import { useChecklist } from './queries';
import { useWorkspace } from './workspace';

function Loading() {
  const { t } = useTranslation();
  return <p className="text-muted-foreground">{t('common.loading')}</p>;
}

export function ChecklistDraftPage({ checklistId }: { checklistId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const detail = useChecklist(checklistId);
  const draft = useQuery({ queryKey: [ws.scope, 'checklists', checklistId, 'draft'], queryFn: () => ws.checklists.draft(checklistId), retry: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [starting, setStarting] = useState(false);

  if (detail.isPending || draft.isPending) return <Loading />;
  if (detail.error) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  const c = detail.data;
  if (draft.error instanceof ApiError && draft.error.code === 'CHECKLIST_NO_DRAFT') {
    const canStart = ws.can.manage && c.status === 'active';
    return (
      <div className="grid max-w-md gap-3">
        <p>{t('checklists.builder.noDraft')}</p>
        {canStart && (
          <Button
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              try {
                await ws.checklists.startDraft(checklistId);
                await draft.refetch();
              } catch (e) {
                toast.error(errorText(t, e));
              } finally {
                setStarting(false);
              }
            }}
          >
            {t('checklists.builder.startDraft')}
          </Button>
        )}
      </div>
    );
  }
  if (draft.error) return <p className="text-destructive">{errorText(t, draft.error)}</p>;

  return (
    <Builder
      key={`${draft.data.id}:${reloadKey}`}
      title={c.name}
      badge={<Badge variant="outline">{t('checklists.draft')}</Badge>}
      initialContent={draft.data.content}
      initialRevision={draft.data.revision}
      readOnly={!ws.can.manage || c.status !== 'active'}
      save={(content, revision) => ws.checklists.saveDraft(checklistId, { content, revision })}
      onPublish={
        ws.can.publish
          ? async (revision, changeNote) => {
              try {
                const v = await ws.checklists.publish(checklistId, { revision, changeNote });
                toast.success(t('checklists.builder.published', { n: v.number }));
                ws.go(`/checklists/${checklistId}`);
                await qc.invalidateQueries({ queryKey: [ws.scope, 'checklists'] });
              } catch (e) {
                toast.error(errorText(t, e));
              }
            }
          : undefined
      }
      onReload={async () => {
        await draft.refetch();
        setReloadKey((k) => k + 1);
      }}
      onBack={() => ws.go(`/checklists/${checklistId}`)}
    />
  );
}

export function ChecklistVersionPage({ checklistId, versionId }: { checklistId: string; versionId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const detail = useChecklist(checklistId);
  const version = useQuery({ queryKey: [ws.scope, 'checklists', checklistId, 'versions', versionId], queryFn: () => ws.checklists.version(checklistId, versionId) });
  if (detail.isPending || version.isPending) return <Loading />;
  if (detail.error || version.error) return <p className="text-destructive">{errorText(t, detail.error ?? version.error)}</p>;
  return (
    <Builder
      title={detail.data.name}
      badge={<Badge variant="outline">{version.data.number ? t('checklists.versionN', { n: version.data.number }) : t('checklists.draft')}</Badge>}
      initialContent={version.data.content}
      initialRevision={version.data.revision}
      readOnly
      onBack={() => ws.go(`/checklists/${checklistId}`)}
    />
  );
}

export function TemplateEditorPage({ source, templateId }: { source: 'global' | 'tenant'; templateId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const tpl = useQuery({ queryKey: [ws.scope, 'templates', source, templateId], queryFn: () => ws.templates.get(source, templateId) });
  const [reloadKey, setReloadKey] = useState(0);
  if (tpl.isPending) return <Loading />;
  if (tpl.error) return <p className="text-destructive">{errorText(t, tpl.error)}</p>;
  const editable = source === 'tenant' && ws.can.templates && tpl.data.status === 'active';
  return (
    <Builder
      key={`${tpl.data.id}:${reloadKey}`}
      title={tpl.data.name}
      badge={<Badge variant="outline">{source === 'global' ? t('checklists.templates.taskop') : t('checklists.templates.template')}</Badge>}
      initialContent={tpl.data.content}
      initialRevision={tpl.data.revision}
      readOnly={!editable}
      save={(content, revision) => ws.templates.saveContent(templateId, { content, revision })}
      onReload={async () => {
        await tpl.refetch();
        setReloadKey((k) => k + 1);
      }}
      onBack={() => ws.go('/templates')}
    />
  );
}
