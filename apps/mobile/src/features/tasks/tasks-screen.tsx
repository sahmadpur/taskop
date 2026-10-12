import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useLiveQuery, useNow } from '@/offline/hooks';
import { groupTasks, TASK_GROUP_KEYS } from './group-tasks';
import { ReviewSection } from './review-section';
import { TaskRow } from './task-row';

/** Spec §7.2: the Tapşırıqlar tab. */
export function TasksScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const now = useNow();
  const session = useSession();
  const canManage = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
  const list = useLiveQuery((s) => s.tasks.tasks(), []);
  const groups = list ? groupTasks(list, now) : null;
  const open = (id: string) => router.push({ pathname: '/task/[id]', params: { id } });
  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.heading}>{t('mobile.tasks.title')}</Text>
        <View style={styles.tools}>
          {canManage ? <PrimaryButton title={`+ ${t('mobile.tasks.create.open')}`} accessibilityLabel={t('mobile.tasks.create.open')} onPress={() => router.push({ pathname: '/task/new', params: { n: services.newId() } })} /> : null}
          <SyncIndicator />
        </View>
      </View>
      {canManage ? <ReviewSection /> : null}
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
  tools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
});
