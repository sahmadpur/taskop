import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useLiveQuery, useNow } from '@/offline/hooks';
import { groupTasks, TASK_GROUP_KEYS } from './group-tasks';
import { TaskRow } from './task-row';

/** Spec §7.2: the Tapşırıqlar tab. */
export function TasksScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const now = useNow();
  const list = useLiveQuery((s) => s.tasks.tasks(), []);
  const groups = list ? groupTasks(list, now) : null;
  const open = (id: string) => router.push({ pathname: '/task/[id]', params: { id } });
  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.heading}>{t('mobile.tasks.title')}</Text>
        <SyncIndicator />
      </View>
      {groups ? (
        TASK_GROUP_KEYS.map((key) => (
          <View key={key} style={styles.group}>
            <Text testID={`section-${key}`} style={styles.section}>
              {t(`mobile.tasks.sections.${key}`)}
            </Text>
            {groups[key].length === 0 ? (
              <Text style={styles.muted}>{t('mobile.tasks.empty')}</Text>
            ) : (
              groups[key].map((task) => <TaskRow key={task.id} task={task} now={now} timeZone={services.timeZone} onPress={() => open(task.id)} />)
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
  heading: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
});
