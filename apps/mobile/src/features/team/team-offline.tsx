import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';

/** Spec §7.1: team data is online only. Retry runs a manual sync, which reads the connection again (decision 8). */
export function TeamOffline() {
  const { t } = useTranslation();
  const services = useOffline();
  const retry = () =>
    void services.syncNow('manual').catch((e: unknown) => console.warn('[team] Manual sync failed', e instanceof Error ? e.message : 'unknown error'));
  return (
    <View style={styles.pad}>
      <Text style={styles.muted}>{t('mobile.team.offline')}</Text>
      <PrimaryButton title={t('common.retry')} onPress={retry} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  muted: { color: colors.muted, fontSize: 16 },
});
