import { type FieldValues, get, type Path, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TextFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  type?: string;
  autoComplete?: string;
  description?: string;
  inputMode?: 'numeric' | 'text' | 'email';
}

export function TextField<T extends FieldValues>({ form, name, label, type = 'text', autoComplete, description, inputMode }: TextFieldProps<T>) {
  const { t } = useTranslation();
  const error = get(form.formState.errors, name)?.message as string | undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type={type} autoComplete={autoComplete} inputMode={inputMode} aria-invalid={Boolean(error)} {...form.register(name)} />
      {description && !error && <p className="text-muted-foreground text-xs">{description}</p>}
      {error && <p className="text-destructive text-sm">{t(error)}</p>}
    </div>
  );
}
