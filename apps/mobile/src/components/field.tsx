import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';

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
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '500', color: colors.text },
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
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});
