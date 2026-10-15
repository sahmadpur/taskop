import type { ReportRun } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge } from '@/features/tasks/task-row';
import { colors, font, radius, spacing, type } from '@/lib/theme';
import { runPerson, statusTone } from './team-format';
import { useLocale } from '@/lib/language';

/** Spec §7.1: checklist, site, person, due time, status badge and problem count; the clock-suspect flag too (spec §8). */
export function RunRow({ run, timeZone, onPress }: { run: ReportRun; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const person = runPerson(t, run);
  const due = t('mobile.team.due', { time: formatDateTime(run.dueAt, { locale, timeZone }) });
  const status = t(`scheduling.statuses.${run.status}`);
  const problems = run.problemCount > 0 ? t('mobile.team.problems', { count: run.problemCount }) : null;
  const critical = run.criticalCount > 0 ? t('mobile.team.critical', { count: run.criticalCount }) : null;
  const late = run.late ? t('executions.flags.late') : null;
  const clockSuspect = run.clockSuspect ? t('executions.flags.clockSuspect') : null;
  return (
    <Pressable
      accessibilityRole="button"
      // The label replaces the children for a screen reader, so it carries all of them.
      accessibilityLabel={[run.checklist.name, run.site.name, person, due, status, problems, critical, late, clockSuspect].filter(Boolean).join('. ')}
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
        {critical ? <Badge text={critical} tone="danger" /> : null}
        {late ? <Badge text={late} tone="warning" /> : null}
        {clockSuspect ? <Badge text={clockSuspect} tone="warning" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1.5, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontFamily: font, fontSize: type.md, fontWeight: '600', color: colors.text },
  muted: { fontFamily: font, fontSize: type.base, color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
