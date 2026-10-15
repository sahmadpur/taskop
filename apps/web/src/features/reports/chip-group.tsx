import { Button } from '@/components/ui/button';

/** One-of-many filter chips (runs buckets, problem severity): a named group of toggle buttons. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o.value} size="sm" variant={o.value === value ? 'default' : 'outline'} className="rounded-full" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
