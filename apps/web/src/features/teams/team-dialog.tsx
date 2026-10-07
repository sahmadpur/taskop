import { zodResolver } from '@hookform/resolvers/zod';
import type { TeamDto, UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CheckboxList } from '@/components/checkbox-list';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { applyFieldErrors, errorText } from '@/lib/errors';

const schema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500) });
export type TeamFormValues = z.output<typeof schema> & { memberIds: string[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team?: TeamDto;
  users: UserDto[];
  canEditMembers: boolean;
  onSubmit: (values: TeamFormValues) => Promise<void>;
}

export function TeamDialog({ open, onOpenChange, team, users, canEditMembers, onSubmit }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? []);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: team?.name ?? '', description: team?.description ?? '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit({ ...values, memberIds });
      onOpenChange(false);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? t('teams.editTitle') : t('teams.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField form={form} name="name" label={t('teams.name')} />
          <TextField form={form} name="description" label={t('teams.description')} />
          {canEditMembers && (
            <CheckboxList
              label={t('teams.members')}
              options={users.map((u) => ({ value: u.id, label: u.fullName }))}
              value={memberIds}
              onChange={setMemberIds}
            />
          )}
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
