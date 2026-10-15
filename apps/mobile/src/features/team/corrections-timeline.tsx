import { type ChecklistContent, type Correction, type ExecutionCorrections, type Item, type ReworkRequest, walkItems } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { answerSummary } from './correction-format';

type Entry = { at: number; request: ReworkRequest; correction?: undefined } | { at: number; correction: Correction; request?: undefined };

/**
 * Spec §8.2 "Corrections" (NFR-07.05, FR-19.13): send-back rounds and corrections in the order they happened. Each
 * correction shows who, when, the round, the value before and after, and the reason. The original-versus-current
 * comparison is on the web (Spec decision 14).
 */
export function CorrectionsTimeline({ content, history, timeZone }: { content: ChecklistContent; history: ExecutionCorrections; timeZone: string }) {
  const { t } = useTranslation();
  const items = new Map<string, Item>();
  walkItems(content, (item) => items.set(item.id, item));
  const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone });
  const label = (itemId: string) => items.get(itemId)?.label ?? t('executions.problemsPage.unknownItem');
  // Rounds first at equal times: a round's request comes before the corrections it caused (stable sort).
  const entries: Entry[] = [
    ...history.reworkRequests.map((request) => ({ at: Date.parse(request.requestedAt), request })),
    ...history.corrections.map((correction) => ({ at: Date.parse(correction.at), correction })),
  ].sort((a, b) => a.at - b.at);
  if (entries.length === 0) return <Text style={styles.muted}>{t('corrections.noCorrections')}</Text>;
  return (
    <View style={styles.list}>
      {entries.map((e) =>
        e.request ? (
          <View key={e.request.id} testID={`rework-${e.request.round}`} style={styles.card}>
            <Text style={styles.label}>
              {`${t('corrections.round', { round: e.request.round })} · ${t('mobile.team.history.requested', {
                // A null requester is a platform admin (Taskop support, Part 1 `reworkRequestSchema`).
                name: e.request.requestedBy?.fullName ?? t('mobile.team.history.platform'),
                count: e.request.items.length,
              })}`}
            </Text>
            <Text style={styles.muted}>{at(e.request.requestedAt)}</Text>
            {e.request.dueAt ? <Text style={styles.muted}>{t('corrections.dueAt', { date: at(e.request.dueAt) })}</Text> : null}
            {e.request.items.map((i) => (
              <Text key={i.itemId} style={styles.value}>{`${label(i.itemId)}: ${i.comment}`}</Text>
            ))}
            {e.request.resubmittedAt ? <Text style={styles.muted}>{t('mobile.team.history.resubmittedAt', { time: at(e.request.resubmittedAt) })}</Text> : null}
            {e.request.withdrawnAt ? <Text style={styles.muted}>{t('mobile.team.history.withdrawnAt', { time: at(e.request.withdrawnAt) })}</Text> : null}
          </View>
        ) : (
          <View key={e.correction.id} testID={`correction-${e.correction.id}`} style={styles.card}>
            <Text style={styles.label}>{label(e.correction.itemId)}</Text>
            <Text style={styles.muted}>
              {[
                t(`corrections.kinds.${e.correction.kind}`),
                ...(e.correction.round > 0 ? [t('corrections.round', { round: e.correction.round })] : []),
                t('mobile.team.history.by', { name: e.correction.actor.name ?? t('mobile.team.history.platform'), time: at(e.correction.at) }),
              ].join(' · ')}
            </Text>
            <Text style={styles.value}>{`${t('mobile.team.history.before')}: ${answerSummary(t, items.get(e.correction.itemId), e.correction.before)}`}</Text>
            <Text style={styles.value}>{`${t('mobile.team.history.after')}: ${answerSummary(t, items.get(e.correction.itemId), e.correction.after)}`}</Text>
            <Text style={styles.muted}>{t('mobile.team.history.reason', { reason: e.correction.reason })}</Text>
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  value: { fontSize: 16, color: colors.text },
  muted: { color: colors.muted },
});
