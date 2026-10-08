import { type ComponentProps, useState } from 'react';
import { Input } from '@/components/ui/input';

interface Props extends Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: number | null;
  /** Called only when the text parses to a finite number. Clamping is the caller's job. */
  onCommit: (n: number) => void;
  /** When set, an empty field commits "no value" (nullable fields). */
  onClear?: () => void;
}

/**
 * Number field that keeps the raw text while focused, so intermediate states
 * such as "-" or an emptied field are not coerced to a number on each keystroke.
 */
export function NumberInput({ value, onCommit, onClear, onFocus, onBlur, ...rest }: Props) {
  const [text, setText] = useState<string | null>(null); // non-null while focused
  const committed = value === null ? '' : String(value);
  return (
    <Input
      {...rest}
      type="number"
      value={text ?? committed}
      onFocus={(e) => {
        setText(committed);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === '') {
          onClear?.();
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={(e) => {
        setText(null);
        onBlur?.(e);
      }}
    />
  );
}
