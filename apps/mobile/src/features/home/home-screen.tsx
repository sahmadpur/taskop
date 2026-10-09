import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { GROUP_KEYS, groupOccurrences, homeStats, type HomeStats } from '@/features/checklists/group-occurrences';
import { OccurrenceCard } from '@/features/checklists/occurrence-card';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { useSession } from '@/lib/session';
import { localDate } from '@/lib/time';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { type OccurrenceView, StartRefusedError } from '@/offline/execution-store';
import { useLiveQuery, useNow } from '@/offline/hooks';

const STATS: { key: keyof HomeStats; color: string }[] = [
  { key: 'myTasks', color: colors.text },
  { key: 'overdue', color: colors.danger },
  { key: 'completed', color: colors.success },
  { key: 'issues', color: colors.danger },
];

/** "My checklists" (spec §7.3, FR-10.01–02). */
export function HomeScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const now = useNow();
  const list = useLiveQuery((x) => x.store.occurrences(), []);
  const groups = list ? groupOccurrences(list, services.userId, now, localDate(now, services.timeZone)) : null;
  const executionIds = groups ? [...groups.inProgress, ...groups.done].flatMap((c) => (c.occurrence.execution ? [c.occurrence.execution.id] : [])) : [];
  const problems = useLiveQuery((x) => x.store.problemCount(executionIds), [executionIds.join(',')]);
  if (s.status !== 'authenticated') return null;
  const stats = groups ? homeStats(groups, problems ?? 0) : null;
  const firstName = s.me.user.fullName.split(' ')[0];

  // The route param is the OCCURRENCE id: an execution's id can change when the sync engine adopts another
  // install's claim, so the execution screen resolves the current execution from the occurrence on every change.
  const openExecution = (o: OccurrenceView) => router.push({ pathname: '/execution/[id]', params: { id: o.id } });
  const start = async (o: OccurrenceView) => {
    if (o.execution) return openExecution(o); // `store.start` is only for occurrences this phone has no execution of
    try {
      await services.store.start(o.id, services.userId);
      openExecution(o);
    } catch (e) {
      Alert.alert(e instanceof StartRefusedError ? t(`mobile.checklists.startBlocked.${e.reason}`) : t('errors.INTERNAL', { requestId: '—' }));
    }
  };
  const open = (o: OccurrenceView) => {
    if (o.execution) openExecution(o);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.greeting}>{t('mobile.home.greeting', { name: firstName })}</Text>
        <SyncIndicator />
      </View>
      {s.offline ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{t('mobile.home.offline')}</Text>
        </View>
      ) : null}
      <Text style={styles.subtitle}>{t('mobile.home.subtitle')}</Text>
      <View style={styles.grid}>
        {STATS.map((stat) => (
          <View key={stat.key} testID={`stat-${stat.key}`} style={styles.tile}>
            <Text style={[styles.value, { color: stat.color }]}>{stats ? String(stats[stat.key]) : '—'}</Text>
            <Text style={styles.tileLabel}>{t(`mobile.home.${stat.key}`)}</Text>
          </View>
        ))}
      </View>
      {groups ? (
        GROUP_KEYS.map((key) => (
          <View key={key} style={styles.group}>
            <Text style={styles.section}>{t(`mobile.checklists.sections.${key}`)}</Text>
            {groups[key].length === 0 ? (
              <Text style={styles.subtitle}>{t('mobile.checklists.emptySection')}</Text>
            ) : (
              groups[key].map((card) => (
                <OccurrenceCard
                  key={card.occurrence.id}
                  card={card}
                  group={key}
                  timeZone={services.timeZone}
                  onStart={() => void start(card.occurrence)}
                  onOpen={() => open(card.occurrence)}
                />
              ))
            )}
          </View>
        ))
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  offline: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  offlineText: { color: '#92400E' },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
  subtitle: { color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  value: { fontSize: 28, fontWeight: '700' },
  tileLabel: { color: colors.muted },
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
});
