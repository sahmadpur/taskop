import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { colors, spacing } from '@/lib/theme';

export const COMMIT_DELAY_MS = 500;

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value: string;
  /** Called 500 ms after typing stops, on blur, and on unmount with unsaved text. */
  onCommit: (text: string) => void;
}

/** A text field that autosaves (spec §7.3) without writing SQLite and the outbox on every keystroke. */
export function CommitInput({ value, onCommit, onBlur, style, ...rest }: Props) {
  const [text, setText] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    if (pending.current === null) setText(value);
  }, [value]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null) commit.current(next);
  }, []);
  useEffect(() => flush, [flush]);
  return (
    <TextInput
      {...rest}
      value={text}
      placeholderTextColor={colors.muted}
      style={[styles.input, rest.multiline ? styles.multiline : null, style]}
      onChangeText={(next) => {
        setText(next);
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, COMMIT_DELAY_MS);
      }}
      onBlur={(e) => {
        flush();
        onBlur?.(e);
      }}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  multiline: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
});
