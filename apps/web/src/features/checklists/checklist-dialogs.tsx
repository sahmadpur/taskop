import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';

export interface DetailsValue {
  name: string;
  description: string | null;
  category: TemplateCategory | null;
}

/** Shared name / description / category form for checklists and templates. */
export function DetailsDialog(props: {
  title: string;
  submitLabel: string;
  initial: DetailsValue;
  categoryRequired?: boolean;
  onClose: () => void;
  onSubmit: (v: DetailsValue) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(props.initial.name);
  const [description, setDescription] = useState(props.initial.description ?? '');
  const [category, setCategory] = useState<TemplateCategory | ''>(props.initial.category ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError(t('checklists.create.nameRequired'));
    if (props.categoryRequired && !category) return setError(t('errors.validation.required'));
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({ name: name.trim(), description: description.trim() || null, category: category || null });
      props.onClose();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="details-name">{t('checklists.name')}</Label>
            <Input id="details-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-description">{t('checklists.description')}</Label>
            <Textarea id="details-description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-category">{t('checklists.category')}</Label>
            <NativeSelect id="details-category" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
              <option value="">{props.categoryRequired ? '—' : t('checklists.noCategory')}</option>
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
          <Button variant="outline" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {props.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
