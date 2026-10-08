import type { ChoiceOption, Item, TemplateCategory } from '@taskop/contracts';
import type { TFunction } from 'i18next';

export function optionLabel(t: TFunction, _item: Item, option: ChoiceOption | { id: string; key: string }, index: number): string {
  if ('key' in option) return t(`checklists.builder.fixedOptions.${option.key}`);
  return option.label.trim() || t('checklists.builder.item.option', { n: index + 1 });
}

export const categoryLabel = (t: TFunction, category: TemplateCategory | null): string =>
  category ? t(`checklists.categories.${category}`) : t('checklists.noCategory');
