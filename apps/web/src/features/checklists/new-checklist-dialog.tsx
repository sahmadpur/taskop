import { TEMPLATE_CATEGORIES, type CreateChecklistInput, type TemplateCategory, type TemplateSummary } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorText } from '@/lib/errors';
import { TemplatePicker } from './template-picker';
import { useWorkspace } from './workspace';

export type NewChecklistMode = 'blank' | 'template' | 'copy';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: NewChecklistMode;
  /** Preselects a checklist to copy (detail page "Copy"). */
  copyFrom?: { id: string; name: string };
  /** Preselects a template (templates page "Use"). */
  template?: TemplateSummary;
}

export function NewChecklistDialog({ open, onOpenChange, initialMode = 'blank', copyFrom, template: initialTemplate }: Props) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [mode, setMode] = useState<NewChecklistMode>(initialMode);
  const [name, setName] = useState(initialTemplate?.name ?? (copyFrom ? t('checklists.create.copySuffix', { name: copyFrom.name }) : ''));
  const [category, setCategory] = useState<TemplateCategory | ''>(initialTemplate?.category ?? '');
  const [template, setTemplate] = useState<TemplateSummary | null>(initialTemplate ?? null);
  const [copyId, setCopyId] = useState(copyFrom?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const published = useQuery({
    queryKey: [ws.scope, 'checklists', 'list', 'published-all'],
    queryFn: async () => (await ws.checklists.list({ limit: 200 })).items.filter((c) => c.currentVersionNumber !== null),
    enabled: open && mode === 'copy',
  });

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError(t('checklists.create.nameRequired'));
    const body: CreateChecklistInput = { name: name.trim() };
    if (category) body.category = category;
    try {
      setBusy(true);
      if (mode === 'template') {
        if (!template) return setError(t('checklists.create.templateRequired'));
        body.from = { kind: template.source, templateId: template.id };
      } else if (mode === 'copy') {
        if (!copyId) return setError(t('checklists.create.pickChecklist'));
        const detail = await ws.checklists.get(copyId);
        if (!detail.currentVersionId) return setError(t('checklists.create.noPublished'));
        body.from = { kind: 'version', versionId: detail.currentVersionId };
      }
      const created = await ws.checklists.create(body);
      onOpenChange(false);
      ws.go(`/checklists/${created.id}/draft`);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('checklists.create.title')}</DialogTitle>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as NewChecklistMode)}>
          <TabsList>
            <TabsTrigger value="blank">{t('checklists.create.blank')}</TabsTrigger>
            <TabsTrigger value="template">{t('checklists.create.fromTemplate')}</TabsTrigger>
            <TabsTrigger value="copy">{t('checklists.create.copy')}</TabsTrigger>
          </TabsList>
          <TabsContent value="template">
            <TemplatePicker
              value={template}
              onPick={(tpl) => {
                if (!name.trim() || name === template?.name) setName(tpl.name);
                setTemplate(tpl);
                setCategory(tpl.category);
              }}
            />
          </TabsContent>
          <TabsContent value="copy">
            <div className="grid gap-1.5">
              <Label htmlFor="copy-from">{t('checklists.create.pickChecklist')}</Label>
              <NativeSelect
                id="copy-from"
                value={copyId}
                onChange={(e) => {
                  const picked = published.data?.find((c) => c.id === e.target.value);
                  setCopyId(e.target.value);
                  if (picked) setName(t('checklists.create.copySuffix', { name: picked.name }));
                }}
              >
                <option value="">—</option>
                {(published.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              {published.data?.length === 0 && <p className="text-muted-foreground text-sm">{t('checklists.create.noPublished')}</p>}
            </div>
          </TabsContent>
        </Tabs>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-checklist-name">{t('checklists.name')}</Label>
            <Input id="new-checklist-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-checklist-category">{t('checklists.category')}</Label>
            <NativeSelect id="new-checklist-category" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
              <option value="">{t('checklists.noCategory')}</option>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`checklists.categories.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
