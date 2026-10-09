import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { claimRejectionText } from '@/features/sync/claim-rejection';
import i18n from '@/lib/i18n';
import { colors, spacing } from '@/lib/theme';
import { OfflineServicesProvider } from './context';
import { openNativeServices } from './native/create-native-services';
import type { OfflineServices } from './services';

/** Opens the encrypted store for the signed-in user and starts syncing; everything under (app) uses it. */
export function OfflineProvider({ userId, timeZone, children }: { userId: string; timeZone: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [services, setServices] = useState<OfflineServices | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setServices(null);
    setFailed(false);
    // Queued behind the previous session's close: the old engine is stopped and its connection closed first.
    const session = openNativeServices(userId, timeZone, {
      onClaimRejected: (r) => Alert.alert(claimRejectionText(i18n.getFixedT(null, 'translation'), r.reason, r.byName)),
    });
    session.ready.then(
      (s) => {
        if (alive) setServices(s);
      },
      (e: unknown) => {
        console.error('[offline] Could not open the local database', e);
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
      session.close().catch((e: unknown) => console.error('[offline] Could not close the local database', e));
    };
  }, [userId, timeZone, attempt]);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('mobile.offline.failed')}</Text>
        <PrimaryButton title={t('mobile.sync.retry')} onPress={() => setAttempt((n) => n + 1)} />
      </View>
    );
  }
  if (!services) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.text}>{t('mobile.offline.preparing')}</Text>
      </View>
    );
  }
  return <OfflineServicesProvider services={services}>{children}</OfflineServicesProvider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  text: { color: colors.muted, textAlign: 'center' },
});
