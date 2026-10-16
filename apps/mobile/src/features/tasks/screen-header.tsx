import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing, type } from '@/lib/theme';

/** A pushed screen's top row: a 44 px back button and the title. */
export function ScreenHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Ionicons name="chevron-back" size={28} color={colors.primary} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  title: { fontFamily: font, fontSize: type.lg, fontWeight: '600', color: colors.text, flexShrink: 1, letterSpacing: -0.3 },
});
