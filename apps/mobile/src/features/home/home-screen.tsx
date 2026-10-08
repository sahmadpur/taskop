import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';

const STATS = [
  { key: 'myTasks', color: colors.text },
  { key: 'overdue', color: colors.danger },
  { key: 'completed', color: colors.success },
  { key: 'issues', color: colors.danger },
] as const;

export function HomeScreen() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  const firstName = s.me.user.fullName.split(' ')[0];
  return (
    <Screen>
      {s.offline && (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{t('mobile.home.offline')}</Text>
        </View>
      )}
      <Text style={styles.greeting}>{t('mobile.home.greeting', { name: firstName })}</Text>
      <Text style={styles.subtitle}>{t('mobile.home.subtitle')}</Text>
      <View style={styles.grid}>
        {STATS.map((stat) => (
          <View key={stat.key} style={styles.card}>
            <Text style={[styles.value, { color: stat.color }]}>—</Text>
            <Text style={styles.cardLabel}>{t(`mobile.home.${stat.key}`)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.section}>{t('mobile.home.recent')}</Text>
      <View style={styles.empty}>
        <Text style={styles.subtitle}>{t('mobile.home.empty')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  offlineText: { color: '#92400E' },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { width: '48%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  value: { fontSize: 28, fontWeight: '700' },
  cardLabel: { color: colors.muted },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  empty: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg, alignItems: 'center' },
});
