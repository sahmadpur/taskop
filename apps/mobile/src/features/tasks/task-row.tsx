import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { isTaskOverdue, isTeamOffer, type TaskView } from '@/offline/task-store';

const TONES = { neutral: colors.muted, warning: colors.warning, danger: colors.danger, success: colors.success } as const;

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: keyof typeof TONES }) {
  return (
    <View style={[styles.badge, { borderColor: TONES[tone] }]}>
      <Text style={[styles.badgeText, { color: TONES[tone] }]}>{text}</Text>
    </View>
  );
}

/** Spec §7.2: title, site, due date, status, overdue and sync badges. */
export function TaskRow({ task, now, timeZone, onPress }: { task: TaskView; now: number; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const s = task.server;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={s.title} testID={`task-${task.id}`} onPress={onPress} style={styles.card}>
      <Text style={styles.title}>{s.title}</Text>
      {s.site ? <Text style={styles.muted}>{s.site.name}</Text> : null}
      {isTeamOffer(task) && s.team ? <Text style={styles.muted}>{t('mobile.tasks.team', { name: s.team.name })}</Text> : null}
      <Text style={styles.muted}>{s.dueAt ? t('mobile.tasks.due', { time: formatDateTime(s.dueAt, { locale: 'az', timeZone }) }) : t('mobile.tasks.noDue')}</Text>
      <View style={styles.badges}>
        <Badge text={t(`tasks.statuses.${task.status}`)} tone={task.status === 'completed' ? 'success' : 'neutral'} />
        {isTaskOverdue(task, now) ? <Badge text={t('tasks.flags.overdue')} tone="danger" /> : null}
        {task.failedKey ? (
          <Badge text={t('mobile.tasks.syncFailed')} tone="danger" />
        ) : task.unsynced ? (
          <Badge text={t('mobile.tasks.syncPending')} tone="warning" />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
