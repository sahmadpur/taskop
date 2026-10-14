import type { ExecutionSummary, OccurrenceDetail } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { ReadOnlyAnswers, ReadOnlyProblems } from '@/features/execution/answer-view';
import { ScreenHeader } from '@/features/tasks/screen-header';
import { Badge } from '@/features/tasks/task-row';
import { api, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';
import { useRefreshMeOnForbidden, useTeamExecution, useTeamOccurrence } from './queries';
import { cancelReasonText, formatLocalDay, percentText, receiptDiffers, statusTone } from './team-format';
import { TeamOffline } from './team-offline';

/** Spec §7.2: media are signed through GET /media/:id/url (Part 1 Task 7 lets reports.view do it). */
const loadMedia = (id: string) => api.media.url(id);

/**
 * Spec §7.2: one run, read-only, online only. The header comes from GET /occurrences/:id. The answers and problems come
 * from GET /executions/:id, requested only when the run has an execution (decision 10).
 */
export function TeamRunScreen({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const me = s.status === 'authenticated' ? s.me : null;
  const viewerId = me?.user.id ?? '';
  const timeZone = me?.tenant.timezone ?? services.timeZone;
  const live = online && me !== null;
  const occurrence = useTeamOccurrence(viewerId, occurrenceId, live);
  const execution = occurrence.data?.execution ?? null;
  const detail = useTeamExecution(viewerId, execution?.id ?? null, live);
  useRefreshMeOnForbidden([occurrence.error, detail.error]);

  if (!me) return null;
  const o = occurrence.data;
  if (!online) {
    return (
      <Screen>
        <ScreenHeader title={o?.checklistName ?? t('mobile.team.run.title')} />
        <TeamOffline />
      </Screen>
    );
  }
  if (!o) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.team.run.title')} />
        {occurrence.error ? <Failed error={occurrence.error} onRetry={() => void occurrence.refetch()} /> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }
  return (
    <Screen>
      <ScreenHeader title={o.checklistName} />
      <Text style={styles.muted}>{o.siteName}</Text>
      <Field label={t('reports.columns.date')} value={formatLocalDay(o.localDate)} />
      <View style={styles.badges}>
        <Badge text={t(`scheduling.statuses.${o.status}`)} tone={statusTone(o.status)} />
        {execution?.late ? <Badge text={t('executions.flags.late')} tone="warning" /> : null}
        {execution?.clockSuspect ? <Badge text={t('executions.flags.clockSuspect')} tone="warning" /> : null}
      </View>
      {execution ? <ExecutionTimes execution={execution} timeZone={timeZone} /> : <NotExecuted occurrence={o} />}
      {execution ? (
        detail.data ? (
          <>
            <Text style={styles.section}>{t('mobile.team.run.answers')}</Text>
            <ReadOnlyAnswers content={detail.data.content} answers={detail.data.answers} media={detail.data.media} problems={detail.data.problems} load={loadMedia} />
            <ReadOnlyProblems content={detail.data.content} problems={detail.data.problems} media={detail.data.media} load={loadMedia} />
          </>
        ) : detail.error ? (
          <Failed error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )
      ) : null}
    </Screen>
  );
}

/** A label and its value; the receipt line under it when there is one. Read out as one. */
function Field({ label, value, note = null }: { label: string; value: string; note?: string | null }) {
  return (
    <View accessible accessibilityLabel={note ? `${label}: ${value}. ${note}` : `${label}: ${value}`} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {note ? <Text style={styles.muted}>{note}</Text> : null}
    </View>
  );
}

/** Executor, device times with the server receipt when it differs (decision 11), and the score once closed (decision 14). */
function ExecutionTimes({ execution: e, timeZone }: { execution: ExecutionSummary; timeZone: string }) {
  const { t } = useTranslation();
  const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone });
  const receipt = (deviceAt: string, receivedAt: string | null) =>
    receivedAt !== null && receiptDiffers(deviceAt, receivedAt) ? t('executions.receivedAt', { time: at(receivedAt) }) : null;
  return (
    <View style={styles.block}>
      <Field label={t('executions.executor')} value={e.executor.fullName} />
      <Field label={t('executions.startedAt')} value={at(e.startedAt)} note={receipt(e.startedAt, e.startedReceivedAt)} />
      {e.completedAt ? <Field label={t('executions.completedAt')} value={at(e.completedAt)} note={receipt(e.completedAt, e.completedReceivedAt)} /> : null}
      {e.state !== 'active' ? <Field label={t('executions.score')} value={e.scorePercent === null ? t('executions.noScore') : percentText(t, e.scorePercent)} /> : null}
    </View>
  );
}

/** Spec §7.2: an unexecuted run shows who it was for and that it has not been done; a cancelled one, why (decision 15). */
function NotExecuted({ occurrence: o }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{t('reports.columns.assignees')}</Text>
      {o.assignees.length > 0 ? (
        o.assignees.map((a) => (
          <Text key={a.id} style={styles.value}>
            {a.fullName}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>{t('reports.employees.unassigned')}</Text>
      )}
      {o.status === 'cancelled' && o.cancelReason ? <Field label={t('mobile.team.run.cancelReason')} value={cancelReasonText(t, o.cancelReason)} /> : null}
      <Text style={styles.notice}>{t('mobile.team.run.notExecuted')}</Text>
    </View>
  );
}

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <FormError message={mobileErrorText(t, error)} />
      <PrimaryButton variant="outline" title={t('common.retry')} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  field: { gap: 2 },
  label: { fontWeight: '600', color: colors.text },
  value: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  notice: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: spacing.sm },
  section: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
