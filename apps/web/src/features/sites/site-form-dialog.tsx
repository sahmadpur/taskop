import { zodResolver } from '@hookform/resolvers/zod';
import type { SiteDto, SiteTypeDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { applyFieldErrors, errorText } from '@/lib/errors';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  typeId: z.uuid(),
  address: z.string().trim().max(300),
});
export type SiteFormValues = z.output<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: SiteTypeDto[];
  site?: SiteDto;
  parent?: SiteDto | null;
  onSubmit: (values: SiteFormValues) => Promise<void>;
}

export function SiteFormDialog({ open, onOpenChange, types, site, parent, onSubmit }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const activeTypes = types.filter((ty) => ty.active || ty.id === site?.typeId);
  const form = useForm<z.input<typeof schema>, unknown, SiteFormValues>({
    resolver: zodResolver(schema),
    values: { name: site?.name ?? '', typeId: site?.typeId ?? activeTypes[0]?.id ?? '', address: site?.address ?? '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{site ? t('sites.form.editTitle') : t('sites.form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {parent && <p className="text-muted-foreground text-sm">{t('sites.form.parent', { name: parent.name })}</p>}
          <TextField form={form} name="name" label={t('sites.form.name')} />
          <div className="grid gap-1.5">
            <Label htmlFor="typeId">{t('sites.form.type')}</Label>
            <NativeSelect id="typeId" {...form.register('typeId')}>
              {activeTypes.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <TextField form={form} name="address" label={t('sites.form.address')} />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
