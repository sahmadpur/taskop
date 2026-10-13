import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api, session, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { nativePush, openSettings, pushTokenStore } from '@/notifications/native';
import { clearAppBadge, endPushSignOut, unregisterPush } from '@/notifications/push-registration';
import { usePushPermission } from '@/notifications/use-push-permission';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';

export function ProfileScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const permission = usePushPermission(nativePush);
  const busy = useRef(false);
  const [isBusy, setBusy] = useState(false);
  // Only the value being saved; otherwise the switch follows the session profile, which refreshes underneath this screen.
  const [pending, setPending] = useState<boolean | null>(null);
  const saving = useRef(false);
  const [isSaving, setSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const rows: [string, string][] = [
    [t('mobile.profile.role'), me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name],
    [t('mobile.profile.organization'), me.tenant.name],
    [t('mobile.profile.login'), me.user.username ?? me.user.email ?? ''],
  ];

  /** Spec §7.4 + decision 13: online only, optimistic, reverted when the server refuses. */
  const changeEmail = async (next: boolean) => {
    if (saving.current) return;
    saving.current = true;
    setSaving(true);
    setEmailError(null);
    setPending(next);
    try {
      const saved = await api.preferences.update({ emailNotifications: next });
      // The session now holds the server's answer, so dropping the override below keeps it; on failure it reverts.
      await session.patchUser({ emailNotifications: saved.emailNotifications });
    } catch (e) {
      setEmailError(mobileErrorText(t, e));
    } finally {
      setPending(null);
      saving.current = false;
      setSaving(false);
    }
  };

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
      // Spec §7.2: before the session ends, so the request still carries this user's token. Blocks push registration
      // first, never throws, and takes at most 3 s.
      await unregisterPush({ push: nativePush, tokens: pushTokenStore, api });
      let cleared = false;
      try {
        await services.clearAll();
        cleared = true;
      } catch (e) {
        // The worker already confirmed; the next sign-in clears another user's data anyway (ensureUser).
        console.error('[offline] Could not clear local data on logout', e instanceof Error ? e.message : 'unknown error');
      }
      // After clearAll, which stops the sync that sets it: nothing can bring the old count back.
      await clearAppBadge(nativePush);
      try {
        await session.signOut();
      } catch (e) {
        console.error('[session] Sign-out failed', e instanceof Error ? e.message : 'unknown error');
        Alert.alert(t('errors.INTERNAL', { requestId: '—' }));
        // The local data is gone and the services are stopped: staying signed in would silently lose later work.
        if (cleared) session.forceSignedOut();
      } finally {
        endPushSignOut();
        release();
      }
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
      <View style={styles.card}>
        <Text style={styles.section}>{t('notifications.title')}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.value}>{t('mobile.notifications.profile.email')}</Text>
          <Switch
            accessibilityLabel={t('mobile.notifications.profile.email')}
            value={pending ?? me.user.emailNotifications}
            disabled={!online || isSaving}
            onValueChange={(next) => void changeEmail(next)}
          />
        </View>
        {me.user.email ? null : <Text style={styles.muted}>{t('mobile.notifications.profile.noEmail')}</Text>}
        {online ? null : <Text style={styles.muted}>{t('mobile.notifications.profile.online')}</Text>}
        <FormError message={emailError} />
        <View style={styles.row}>
          <Text style={styles.muted}>{t('mobile.notifications.profile.push')}</Text>
          <Text testID="push-permission" style={styles.value}>
            {permission ? t(`mobile.notifications.profile.pushStates.${permission}`) : '—'}
          </Text>
        </View>
        {permission === 'denied' ? (
          <>
            <Text style={styles.muted}>{t('mobile.notifications.profile.deniedHint')}</Text>
            <PrimaryButton variant="outline" title={t('mobile.notifications.profile.openSettings')} onPress={() => void openSettings()} />
          </>
        ) : null}
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: spacing.md },
  section: { fontSize: 16, fontWeight: '600', color: colors.text },
  value: { color: colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
});
