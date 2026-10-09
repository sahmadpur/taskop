import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { session, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';

export function ProfileScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const busy = useRef(false);
  const [isBusy, setBusy] = useState(false);
  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const rows: [string, string][] = [
    [t('mobile.profile.role'), me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name],
    [t('mobile.profile.organization'), me.tenant.name],
    [t('mobile.profile.login'), me.user.username ?? me.user.email ?? ''],
  ];

  /** Spec §7.4: unsynced data blocks logout until the worker confirms twice; local data never outlives the session. */
  const logout = async () => {
    if (busy.current) return;
    busy.current = true;
    setBusy(true);
    const release = () => {
      busy.current = false;
      setBusy(false);
    };
    const finish = async () => {
      try {
        await services.clearAll();
      } catch (e) {
        // The worker already confirmed; the next sign-in clears another user's data anyway (ensureUser).
        console.error('[offline] Could not clear local data on logout', e instanceof Error ? e.message : 'unknown error');
      }
      await session.signOut();
    };
    const confirmDelete = () =>
      Alert.alert(
        t('mobile.logout.confirmTitle'),
        t('mobile.logout.confirmBody'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: release },
          { text: t('mobile.logout.confirm'), style: 'destructive', onPress: () => void finish() },
        ],
        { cancelable: false },
      );
    let unsynced: number | null;
    try {
      unsynced = await services.store.unsyncedCount();
    } catch (e) {
      console.error('[offline] Could not count unsynced data on logout', e instanceof Error ? e.message : 'unknown error');
      unsynced = null; // Unknown: assume unsynced data may exist.
    }
    if (unsynced === 0) {
      await finish();
      return;
    }
    if (unsynced === null) {
      confirmDelete();
      return;
    }
    Alert.alert(
      t('mobile.logout.unsyncedTitle'),
      t('mobile.logout.unsyncedBody', { count: unsynced }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: release },
        { text: t('mobile.logout.continue'), style: 'destructive', onPress: confirmDelete },
      ],
      { cancelable: false },
    );
  };
  return (
    <Screen>
      <Text style={styles.name}>{me.user.fullName}</Text>
      {me.user.jobTitle ? <Text style={styles.muted}>{me.user.jobTitle}</Text> : null}
      <View style={styles.card}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton variant="outline" title={t('mobile.profile.changeSecret')} onPress={() => router.push('/change-secret')} />
      <PrimaryButton title={t('mobile.profile.logout')} disabled={isBusy} onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  value: { color: colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
});
