import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function CheckboxList({ label, options, value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const visible = options.filter((o) => o.label.toLocaleLowerCase('az').includes(query.toLocaleLowerCase('az')));
  const toggle = (v: string, checked: boolean) => onChange(checked ? [...value, v] : value.filter((x) => x !== v));
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{label}</legend>
      <Input type="search" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border p-3">
        {visible.length === 0 && <p className="text-muted-foreground text-sm">{t('common.noResults')}</p>}
        {visible.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <Checkbox id={`${id}-${o.value}`} checked={value.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
            <Label htmlFor={`${id}-${o.value}`} className="font-normal">
              {o.label}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
