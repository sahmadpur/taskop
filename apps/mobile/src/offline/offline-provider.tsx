import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { claimRejectionText } from '@/features/sync/claim-rejection';
import i18n from '@/lib/i18n';
import { colors, spacing } from '@/lib/theme';
import { OfflineServicesProvider } from './context';
import { createNativeServices } from './native/create-native-services';
import type { OfflineServices } from './services';

/** Opens the encrypted store for the signed-in user and starts syncing; everything under (app) uses it. */
export function OfflineProvider({ userId, timeZone, children }: { userId: string; timeZone: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [services, setServices] = useState<OfflineServices | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let created: OfflineServices | null = null;
    setServices(null);
    setFailed(false);
    createNativeServices(userId, timeZone, {
      onClaimRejected: (r) => Alert.alert(claimRejectionText(i18n.getFixedT(null, 'translation'), r.reason, r.byName)),
    })
      .then((s) => {
        created = s;
        if (alive) setServices(s);
        else void s.dispose();
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      void created?.dispose();
    };
  }, [userId, timeZone]);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('mobile.offline.failed')}</Text>
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
