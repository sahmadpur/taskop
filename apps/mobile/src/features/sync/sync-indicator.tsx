import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing, type } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';
import { type Indicator, indicatorOf } from '@/offline/sync-engine';

const TONE: Record<Indicator, { dot: string; bg: string; fg: string }> = {
  synced: { dot: colors.success, bg: colors.successSoft, fg: colors.successText },
  pending: { dot: colors.warning, bg: colors.warningSoft, fg: colors.warningText },
  offline: { dot: colors.warning, bg: colors.warningSoft, fg: colors.warningText },
  failed: { dot: colors.danger, bg: colors.dangerSoft, fg: colors.dangerText },
};

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
      style={[styles.pill, { backgroundColor: TONE[state].bg }]}
    >
      <View style={[styles.dot, { backgroundColor: TONE[state].dot }]} />
      <Text style={[styles.text, { color: TONE[state].fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: 22 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { fontFamily: font, fontSize: type.sm, fontWeight: '600' },
});
