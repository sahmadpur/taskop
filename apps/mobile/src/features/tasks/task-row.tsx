import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusChip } from '@/components/chip';
import { useLocale } from '@/lib/language';
import { colors, font, radius, spacing, type, type Tone } from '@/lib/theme';
import { isTaskOverdue, isTeamOffer, type TaskView } from '@/offline/task-store';

/** The status chip the task, run and audit screens share. */
export function Badge({ text, tone = 'neutral', testID }: { text: string; tone?: Tone; testID?: string }) {
  return <StatusChip text={text} tone={tone} testID={testID} />;
}

/** Spec §7.2: title, site, due date, status, overdue and sync badges. */
export function TaskRow({ task, now, timeZone, onPress }: { task: TaskView; now: number; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const s = task.server;
  const overdue = isTaskOverdue(task, now);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={s.title}
      testID={`task-${task.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, overdue && styles.overdue, task.status === 'completed' && styles.done, pressed && styles.pressed]}
    >
      <Text style={styles.title}>{s.title}</Text>
      {s.site ? <Text style={styles.muted}>{s.site.name}</Text> : null}
      {isTeamOffer(task) && s.team ? <Text style={styles.muted}>{t('mobile.tasks.team', { name: s.team.name })}</Text> : null}
      <Text style={[styles.muted, overdue && styles.overdueText]}>{s.dueAt ? t('mobile.tasks.due', { time: formatDateTime(s.dueAt, { locale, timeZone }) }) : t('mobile.tasks.noDue')}</Text>
      <View style={styles.badges}>
        <Badge text={t(`tasks.statuses.${task.status}`)} tone={task.status === 'completed' ? 'success' : task.status === 'new' ? 'neutral' : 'active'} />
        {overdue ? <Badge text={t('tasks.flags.overdue')} tone="danger" /> : null}
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
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1.5, borderColor: colors.border, borderLeftWidth: 5, borderLeftColor: colors.primary, padding: spacing.md, gap: spacing.xs },
  overdue: { borderLeftColor: colors.danger },
  done: { borderLeftColor: colors.success },
  pressed: { backgroundColor: colors.plannedSoft },
  title: { fontFamily: font, fontSize: type.md, fontWeight: '600', color: colors.text },
  muted: { fontFamily: font, fontSize: type.base, color: colors.muted },
  overdueText: { color: colors.dangerText },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
