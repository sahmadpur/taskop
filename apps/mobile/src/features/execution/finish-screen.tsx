import { computeScore, deriveProblems, type Missing, requirements, walkItems } from '@taskop/contracts';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { ExecutionLockedError } from '@/offline/execution-store';
import { useNow } from '@/offline/hooks';
import { readOnlyReason, useExecution } from './use-execution';

let jumps = 0;
/** A new value per jump, so the execution screen reacts even when it is still mounted and the item is the same. */
const nextJump = () => `${Date.now()}-${++jumps}`;

/** Spec §7.3: what still blocks completion (tap to jump), a score preview, and "Tamamla" (FR-08.06). `occurrenceId` is the route's id. */
export function FinishScreen({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const { store, userId } = useOffline();
  const data = useExecution(occurrenceId);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  // What the store refused completion for, in case it disagrees with the list computed here.
  const [refused, setRefused] = useState<Missing[]>([]);
  const answers = data?.execution.answers;
  useEffect(() => setRefused([]), [answers]);

  if (data === undefined) return <ActivityIndicator color={colors.primary} />;
  if (data === null) return <Text style={styles.muted}>{t('mobile.execution.notFound')}</Text>;
  if (data.content.kind !== 'ok') return <Text style={styles.title}>{t('mobile.execution.needsUpdate')}</Text>;

  const content = data.content.content;
  const current = data.execution.answers;
  const computed = requirements(content, current);
  const missing = computed.length ? computed : refused;
  const score = computeScore(content, current);
  const problems = deriveProblems(content, current);
  const labels = new Map<string, string>();
  walkItems(content, (item) => labels.set(item.id, item.label));
  const readOnly = readOnlyReason(data.execution, data.occurrence, userId, now) !== null;

  const complete = async () => {
    setBusy(true);
    try {
      // Always the execution's current id: it changes when the sync engine adopts my other install's claim.
      const result = await store.complete(data.execution.id);
      if (result.ok) {
        Alert.alert(t('mobile.finish.completed'));
        router.replace('/');
      } else setRefused(result.missing);
    } catch (e) {
      if (!(e instanceof ExecutionLockedError)) Alert.alert(t('errors.INTERNAL', { requestId: '—' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.push({ pathname: '/execution/[id]', params: { id: occurrenceId } })}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>{t('mobile.finish.title')}</Text>
          <Text style={styles.muted}>{data.occurrence.checklistName}</Text>
        </View>
      </View>
      <Text style={styles.section}>{t('mobile.finish.missingTitle')}</Text>
      {missing.length === 0 ? (
        <Text style={styles.muted}>{t('mobile.finish.none')}</Text>
      ) : (
        missing.map((m) => {
          const label = labels.get(m.itemId) ?? '';
          const kind = t(`mobile.finish.missingKinds.${m.kind}`);
          return (
            <Pressable
              key={`${m.itemId}-${m.kind}`}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${kind}`}
              onPress={() => router.push({ pathname: '/execution/[id]', params: { id: occurrenceId, itemId: m.itemId, focus: nextJump() } })}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.missing}>{kind}</Text>
            </Pressable>
          );
        })
      )}
      <View style={styles.card}>
        <Text style={styles.muted}>{t('mobile.finish.score')}</Text>
        <Text style={styles.score}>{content.scoring.enabled && score.percent !== null ? `${score.percent}%` : t('mobile.finish.noScore')}</Text>
        <Text style={styles.muted}>{t('mobile.finish.problems', { count: problems.length })}</Text>
      </View>
      <PrimaryButton title={t('mobile.finish.complete')} disabled={busy || readOnly || missing.length > 0} onPress={() => void complete()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  section: { fontSize: 16, fontWeight: '600', color: colors.text },
  row: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.warning, padding: spacing.md, gap: spacing.xs },
  rowLabel: { color: colors.text, fontWeight: '500' },
  missing: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  score: { fontSize: 32, fontWeight: '700', color: colors.text },
});
