import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';

export function ScreenHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, flexShrink: 1 },
});
