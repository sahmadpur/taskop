import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';
import { type Indicator, indicatorOf } from '@/offline/sync-engine';

const TONE: Record<Indicator, string> = { synced: colors.success, pending: colors.warning, offline: colors.warning, failed: colors.danger };

/** Spec §7.3: green (all synced), amber "N gözləyir" (offline or pending), red (failed). Opens the queue. */
export function SyncIndicator() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const state = indicatorOf(status);
  const label =
    state === 'synced'
      ? t('mobile.sync.synced')
      : state === 'pending'
        ? t('mobile.sync.pending', { count: status.pending })
        : state === 'offline'
          ? t('mobile.sync.offline')
          : t('mobile.sync.failed', { count: status.failed });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`sync-indicator-${state}`}
      onPress={() => router.push('/sync')}
      style={[styles.pill, { borderColor: TONE[state] }]}
    >
      <View style={[styles.dot, { backgroundColor: TONE[state] }]} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: 22, backgroundColor: colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { color: colors.text, fontSize: 13, fontWeight: '500' },
});
