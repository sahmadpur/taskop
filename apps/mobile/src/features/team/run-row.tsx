import type { ReportRun } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge } from '@/features/tasks/task-row';
import { colors, spacing } from '@/lib/theme';
import { runPerson, statusTone } from './team-format';

/** Spec §7.1: checklist, site, person, due time, status badge and problem count; the clock-suspect flag too (spec §8). */
export function RunRow({ run, timeZone, onPress }: { run: ReportRun; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const person = runPerson(t, run);
  const due = t('mobile.team.due', { time: formatDateTime(run.dueAt, { locale: 'az', timeZone }) });
  const status = t(`scheduling.statuses.${run.status}`);
  const problems = run.problemCount > 0 ? t('mobile.team.problems', { count: run.problemCount }) : null;
  return (
    <Pressable
      accessibilityRole="button"
      // The label replaces the children for a screen reader, so it carries all of them.
      accessibilityLabel={[run.checklist.name, run.site.name, person, due, status, problems].filter(Boolean).join('. ')}
      testID={`run-${run.occurrenceId}`}
      onPress={onPress}
      style={styles.card}
    >
      <Text style={styles.title}>{run.checklist.name}</Text>
      <Text style={styles.muted}>{run.site.name}</Text>
      <Text style={styles.muted}>{person}</Text>
      <Text style={styles.muted}>{due}</Text>
      <View style={styles.badges}>
        <Badge text={status} tone={statusTone(run.status)} />
        {problems ? <Badge text={problems} tone={run.criticalCount > 0 ? 'danger' : 'warning'} /> : null}
        {run.criticalCount > 0 ? <Badge text={t('mobile.team.critical', { count: run.criticalCount })} tone="danger" /> : null}
        {run.late ? <Badge text={t('executions.flags.late')} tone="warning" /> : null}
        {run.clockSuspect ? <Badge text={t('executions.flags.clockSuspect')} tone="warning" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
