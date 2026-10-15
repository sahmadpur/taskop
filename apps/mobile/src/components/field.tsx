import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors, font, radius, spacing, type } from '@/lib/theme';

interface Props extends Pick<TextInputProps, 'value' | 'onChangeText' | 'secureTextEntry' | 'keyboardType' | 'autoCapitalize' | 'autoComplete' | 'onBlur'> {
  label: string;
  error?: string | null;
}

export function Field({ label, error, ...input }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        style={[styles.input, error ? styles.inputError : null]}
        placeholderTextColor={colors.muted}
        {...input}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontFamily: font, fontSize: type.base, fontWeight: '500', color: colors.text },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    fontFamily: font,
    fontSize: type.md,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  error: { fontFamily: font, color: colors.dangerText, fontSize: type.sm },
});
