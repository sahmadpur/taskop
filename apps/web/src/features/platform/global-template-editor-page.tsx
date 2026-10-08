import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Builder } from '@/features/checklists/builder/builder';
import { errorText } from '@/lib/errors';
import { platformApi } from './platform-session';

export function GlobalTemplateEditorPage() {
  const { t } = useTranslation();
  const { templateId } = useParams({ strict: false }) as { templateId: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tpl = useQuery({
    queryKey: ['platform', 'global-templates', templateId],
    queryFn: () => platformApi.globalTemplates.get(templateId),
    // gcTime 0: drop the cache on unmount so re-opening the editor never mounts stale content/revision (would 409 on save).
    gcTime: 0,
  });
  const [reloadKey, setReloadKey] = useState(0);
  if (tpl.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (tpl.error) return <p className="text-destructive">{errorText(t, tpl.error)}</p>;
  const g = tpl.data;
  const toggle = async () => {
    try {
      await (g.published
        ? platformApi.globalTemplates.unpublish(g.id)
        : platformApi.globalTemplates.publish(g.id));
      await qc.invalidateQueries({ queryKey: ['platform', 'global-templates'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  return (
    <Builder
      key={`${g.id}:${reloadKey}`}
      title={g.name}
      badge={
        <Badge variant={g.published ? 'default' : 'secondary'}>
          {g.published ? t('checklists.templates.published') : t('checklists.templates.unpublished')}
        </Badge>
      }
      actions={
        <Button size="sm" variant="outline" onClick={() => void toggle()}>
          {g.published ? t('checklists.templates.unpublish') : t('checklists.templates.publish')}
        </Button>
      }
      initialContent={g.content}
      initialRevision={g.revision}
      readOnly={false}
      save={(content, revision) => platformApi.globalTemplates.saveContent(g.id, { content, revision })}
      onReload={async () => {
        await tpl.refetch();
        setReloadKey((k) => k + 1);
      }}
      onBack={() => void navigate({ to: '/platform/templates' as '/platform/tenants' })}
    />
  );
}
