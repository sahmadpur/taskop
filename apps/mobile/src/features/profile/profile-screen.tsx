import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { session, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';

export function ProfileScreen() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const rows: [string, string][] = [
    [t('mobile.profile.role'), me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name],
    [t('mobile.profile.organization'), me.tenant.name],
    [t('mobile.profile.login'), me.user.username ?? me.user.email ?? ''],
  ];
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
      <PrimaryButton title={t('mobile.profile.logout')} onPress={() => void session.signOut()} />
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
