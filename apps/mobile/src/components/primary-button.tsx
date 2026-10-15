import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, font, radius, spacing, type } from '@/lib/theme';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'outline' | 'danger';
  accessibilityLabel?: string;
}

/** The app's button: 52 px tall and 17 px bold, so it is readable in sunlight and pressable with gloves. */
export function PrimaryButton({ title, onPress, disabled, variant = 'primary', accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[variant], pressed && pressedStyles[variant], disabled && styles.disabled]}
    >
      <Text style={[styles.text, textStyles[variant]]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 52, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: 'transparent' },
  primary: { backgroundColor: colors.primary },
  outline: { borderColor: colors.primary, backgroundColor: colors.surface },
  danger: { backgroundColor: colors.dangerSoft },
  disabled: { opacity: 0.5 },
  text: { fontFamily: font, color: colors.primaryText, fontSize: type.md, fontWeight: '600' },
});
const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primaryDeep },
  outline: { backgroundColor: colors.primarySoft },
  danger: { opacity: 0.8 },
});
const textStyles = StyleSheet.create({
  primary: {},
  outline: { color: colors.primary },
  danger: { color: colors.dangerText },
});
