import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/lib/theme';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
  accessibilityLabel?: string;
}

export function PrimaryButton({ title, onPress, disabled, variant = 'primary', accessibilityLabel }: Props) {
  const outline = variant === 'outline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, outline ? styles.outline : styles.primary, (pressed || disabled) && styles.dim]}
    >
      <Text style={[styles.text, outline ? styles.outlineText : null]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.primary },
  outline: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  dim: { opacity: 0.6 },
  text: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  outlineText: { color: colors.primary },
});
