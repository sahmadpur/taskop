import { zodResolver } from '@hookform/resolvers/zod';
import { localTimeSchema, type ShiftDto, type SiteDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyFieldErrors, errorText } from '@/lib/errors';

const schema = z
  .object({ name: z.string().trim().min(1).max(100), startTime: localTimeSchema, endTime: localTimeSchema, siteId: z.string() })
  .refine((v) => v.startTime !== v.endTime, { path: ['endTime'], message: 'scheduling.issues.shiftZeroLength' });

export interface ShiftFormValues {
  name: string;
  startTime: string;
  endTime: string;
  siteId: string | null;
}

interface Props {
  shift?: ShiftDto;
  sites: SiteDto[];
  onClose: () => void;
  onSubmit: (values: ShiftFormValues) => Promise<void>;
}

export function ShiftDialog({ shift, sites, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: shift?.name ?? '', startTime: shift?.startTime ?? '08:00', endTime: shift?.endTime ?? '16:00', siteId: shift?.siteId ?? '' },
  });
  const [start, end] = form.watch(['startTime', 'endTime']);
  // The shift's own site is always an option, even when it is inactive or not loaded, so editing never clears it.
  const siteOptions =
    shift?.siteId && !sites.some((s) => s.id === shift.siteId)
      ? [{ id: shift.siteId, name: shift.siteName ?? shift.siteId }, ...sites]
      : sites;
  const fieldError = (name: 'startTime' | 'endTime') => form.formState.errors[name]?.message;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await onSubmit({ ...v, siteId: v.siteId || null });
      onClose();
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shift ? t('scheduling.shifts.editTitle') : t('scheduling.shifts.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField form={form} name="name" label={t('scheduling.shifts.name')} />
          <div className="grid grid-cols-2 gap-3">
            {(['startTime', 'endTime'] as const).map((name) => (
              <div key={name} className="grid gap-1.5">
                <Label htmlFor={name}>{name === 'startTime' ? t('scheduling.shifts.start') : t('scheduling.shifts.end')}</Label>
                <Input id={name} type="time" aria-invalid={Boolean(fieldError(name))} {...form.register(name)} />
                {fieldError(name) && <p className="text-destructive text-sm">{t(fieldError(name)!)}</p>}
              </div>
            ))}
          </div>
          {start && end && end < start && <p className="text-muted-foreground text-sm">{t('scheduling.shifts.nextDay')}</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="siteId">{t('scheduling.shifts.site')}</Label>
            <NativeSelect id="siteId" {...form.register('siteId')}>
              <option value="">{t('scheduling.shifts.allSites')}</option>
              {siteOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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
