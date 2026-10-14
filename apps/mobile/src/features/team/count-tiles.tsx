import type { ReportSummary } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { percentText } from './team-format';
import { notCompleted } from './team-rules';

/** Spec §7.1 (FR-16.03): completed, not completed, overdue, partial, with problems, completion %. */
export function CountTiles({ summary }: { summary: ReportSummary }) {
  const { t } = useTranslation();
  const c = summary.counts;
  const tiles = [
    { key: 'completed', label: t('reports.counts.completed'), value: String(c.completed), color: colors.success },
    { key: 'notCompleted', label: t('reports.notCompleted'), value: String(notCompleted(c)), color: colors.text },
    { key: 'overdue', label: t('reports.counts.overdue'), value: String(c.overdue), color: colors.danger },
    { key: 'partial', label: t('reports.counts.partial'), value: String(c.partial), color: colors.warning },
    { key: 'withProblems', label: t('reports.counts.withProblems'), value: String(c.withProblems), color: colors.danger },
    { key: 'completionPercent', label: t('reports.measures.completionPercent'), value: percentText(t, summary.completionPercent), color: colors.primary },
  ];
  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <View key={tile.key} testID={`tile-${tile.key}`} accessible accessibilityLabel={`${tile.label}: ${tile.value}`} style={styles.tile}>
          <Text style={[styles.value, { color: tile.color }]}>{tile.value}</Text>
          <Text style={styles.label}>{tile.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: 72,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  value: { fontSize: 22, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 13 },
});
