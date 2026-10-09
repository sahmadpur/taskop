import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateSummary } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { cn } from '@/lib/utils';
import { categoryLabel } from './labels';
import { useTemplates } from './queries';

export function TemplatePicker({ value, onPick }: { value: TemplateSummary | null; onPick: (t: TemplateSummary) => void }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<TemplateCategory | ''>('');
  const templates = useTemplates({ status: 'active', category: category || undefined });
  return (
    <div className="grid gap-2">
      <NativeSelect aria-label={t('checklists.filters.category')} value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
        <option value="">{t('checklists.filters.allCategories')}</option>
        {TEMPLATE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`checklists.categories.${c}`)}
          </option>
        ))}
      </NativeSelect>
      <div role="radiogroup" aria-label={t('checklists.create.pickTemplate')} className="grid max-h-64 gap-1 overflow-y-auto">
        {(templates.data ?? []).map((tpl) => (
          <button
            key={`${tpl.source}:${tpl.id}`}
            type="button"
            role="radio"
            aria-checked={value?.id === tpl.id}
            onClick={() => onPick(tpl)}
            className={cn('rounded-md border px-3 py-2 text-left text-sm', value?.id === tpl.id && 'border-primary bg-primary/5')}
          >
            <span className="font-medium">{tpl.name}</span>
            <span className="text-muted-foreground block text-xs">
              {tpl.source === 'global' ? t('checklists.templates.taskop') : t('checklists.templates.ours')} · {categoryLabel(t, tpl.category)} ·{' '}
              {t('checklists.templates.items', { count: tpl.itemCount })}
            </span>
          </button>
        ))}
        {templates.data?.length === 0 && <p className="text-muted-foreground text-sm">{t('checklists.templates.empty')}</p>}
      </div>
    </div>
  );
}
