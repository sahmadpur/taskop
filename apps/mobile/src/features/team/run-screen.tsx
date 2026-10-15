import { ApiError } from '@taskop/api-client';
import { type ChecklistContent, type ExecutionSummary, type OccurrenceDetail, type ReworkRequest, runAuditState, walkItems } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
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
import { AuditPanel } from './audit-panel';
import { CorrectMode } from './correct-mode';
import { CorrectionsTimeline } from './corrections-timeline';
import { useRefreshMeOnForbidden, useRunCommand, useTeamCorrections, useTeamExecution, useTeamOccurrence } from './queries';
import { NO_ACTIONS, type RunActions, runActions } from './run-actions';
import { SendBackMode } from './send-back-mode';
import { cancelReasonText, formatLocalDay, percentText, receiptDiffers, statusTone } from './team-format';
import { TeamOffline } from './team-offline';

/** Spec §7.2: media are signed through GET /media/:id/url (Part 1 Task 7 lets reports.view do it). */
const loadMedia = (id: string) => api.media.url(id);

/** What replaces the run view while it is open (SP8 spec §8.2). Each open mounts it fresh, so picks and drafts never leak. */
type RunMode = { kind: 'audit'; auditId: string } | { kind: 'correct' } | { kind: 'sendBack' } | null;

/**
 * Spec §7.2: one run, read-only, online only. The header comes from GET /occurrences/:id. The answers and problems come
 * from GET /executions/:id, requested only when the run has an execution (decision 10).
 * SP8 spec §8.2: the actions the viewer may take (Task 7's rule), each opening a mode that replaces the run view. A mode
 * stays open, with its draft, when the connection drops; only its server buttons turn off. When a refusal refreshes the
 * run and the mode is no longer allowed, the run view returns and keeps showing the refusal.
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
  const d = detail.data;
  const corrections = useTeamCorrections(viewerId, d && (d.corrected || d.reworkRound > 0) ? d.id : null, live);
  const command = useRunCommand(viewerId);
  const [mode, setMode] = useState<RunMode>(null);
  useRefreshMeOnForbidden([occurrence.error, detail.error, corrections.error]);

  const o = occurrence.data;
  const actions = me && o && d ? runActions(me.permissions, o.status, d.state, d.audit) : NO_ACTIONS;
  // A mode the run no longer allows (a refusal refreshed it) closes; the audit panel is not gated, it follows its own audit.
  const modeAllowed = mode === null || mode.kind === 'audit' || (mode.kind === 'correct' ? actions.correct : actions.sendBack);
  const staleMode = mode !== null && o !== undefined && d !== undefined && !modeAllowed;
  useEffect(() => {
    if (staleMode) setMode(null);
  }, [staleMode]);
  const current = staleMode ? null : mode;

  if (!me) return null;
  const title = o?.checklistName ?? t('mobile.team.run.title');
  const close = () => setMode(null);
  if (!online && current === null) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <TeamOffline />
      </Screen>
    );
  }
  if (current?.kind === 'audit') {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <AuditPanel key={current.auditId} viewerId={viewerId} auditId={current.auditId} online={online} command={command} onClose={close} />
      </Screen>
    );
  }
  if (current && d) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        {current.kind === 'correct' ? (
          <CorrectMode detail={d} online={online} command={command} reload={async () => (await detail.refetch()).data} onDone={close} onCancel={close} />
        ) : (
          <SendBackMode detail={d} online={online} command={command} onDone={close} onCancel={close} />
        )}
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

  const auditState = d?.audit ? runAuditState(o.status, d.audit) : null;
  const auditPercent = d?.audit && (auditState === 'passed' || auditState === 'failed') && d.audit.percent !== null ? ` · ${percentText(t, d.audit.percent)}` : '';
  const open = (next: RunMode) => {
    command.clearError();
    setMode(next);
  };
  const startAudit = async (executionId: string) => {
    const r = await command.run(() => api.audits.start(executionId));
    if (!r) return;
    if (r.ok) return open({ kind: 'audit', auditId: r.value.id });
    // Another auditor started one first: open theirs (Part 1 decision 14) instead of showing the refusal.
    if (r.error instanceof ApiError && r.error.code === 'AUDIT_EXISTS' && r.error.auditId) open({ kind: 'audit', auditId: r.error.auditId });
  };
  const withdraw = (executionId: string) =>
    Alert.alert(t('mobile.team.sendBack.withdrawTitle'), t('mobile.team.sendBack.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('corrections.actions.withdraw'),
        style: 'destructive',
        onPress: () =>
          void command.run(() => api.corrections.withdraw(executionId)).then((r) => {
            if (r?.ok) Alert.alert(t('mobile.team.sendBack.withdrawn'));
          }),
      },
    ]);

  return (
    <Screen>
      <ScreenHeader title={o.checklistName} />
      <Text style={styles.muted}>{o.siteName}</Text>
      <Field label={t('reports.columns.date')} value={formatLocalDay(o.localDate)} />
      <View style={styles.badges}>
        <Badge text={t(`scheduling.statuses.${o.status}`)} tone={statusTone(o.status)} />
        {execution?.late ? <Badge text={t('executions.flags.late')} tone="warning" /> : null}
        {execution?.clockSuspect ? <Badge text={t('executions.flags.clockSuspect')} tone="warning" /> : null}
        {auditState ? (
          <Badge
            text={`${t('audits.audit')}: ${t(`audits.runAuditStates.${auditState}`)}${auditPercent}`}
            tone={auditState === 'failed' ? 'danger' : auditState === 'passed' ? 'success' : 'neutral'}
          />
        ) : null}
        {d?.corrected ? <Badge text={t('corrections.corrected')} tone="warning" /> : null}
      </View>
      {execution ? <ExecutionTimes execution={execution} timeZone={timeZone} /> : <NotExecuted occurrence={o} />}
      {d ? (
        <ActionsBar
          actions={actions}
          online={online}
          busy={command.busy}
          onStartAudit={() => void startAudit(d.id)}
          onOpenAudit={() => (d.audit ? open({ kind: 'audit', auditId: d.audit.id }) : undefined)}
          onCorrect={() => open({ kind: 'correct' })}
          onSendBack={() => open({ kind: 'sendBack' })}
          onWithdraw={() => withdraw(d.id)}
        />
      ) : null}
      {/* Only here: every mode and the audit panel show their own failures. */}
      <FormError message={command.error ? mobileErrorText(t, command.error) : null} />
      {d?.rework ? <ReworkSummary rework={d.rework} content={d.content} timeZone={timeZone} /> : null}
      {execution ? (
        d ? (
          <>
            <Text style={styles.section}>{t('mobile.team.run.answers')}</Text>
            <ReadOnlyAnswers content={d.content} answers={d.answers} media={d.media} problems={d.problems} load={loadMedia} />
            <ReadOnlyProblems content={d.content} problems={d.problems} media={d.media} load={loadMedia} />
            {corrections.data ? (
              <>
                <Text style={styles.section}>{t('corrections.title')}</Text>
                <CorrectionsTimeline content={d.content} history={corrections.data} timeZone={timeZone} />
              </>
            ) : null}
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

/** Spec §8.2: Audit (audits.perform), Correct and Send back, or Withdraw (executions.correct), as `runActions` allows. Every one needs the server. */
function ActionsBar(p: {
  actions: RunActions;
  online: boolean;
  busy: boolean;
  onStartAudit: () => void;
  onOpenAudit: () => void;
  onCorrect: () => void;
  onSendBack: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  const a = p.actions;
  if (!a.audit && !a.correct && !a.sendBack && !a.withdraw) return null;
  const off = !p.online;
  return (
    <View testID="run-actions" style={styles.actions}>
      {a.audit === 'start' ? <PrimaryButton title={t('audits.actions.start')} disabled={off || p.busy} onPress={p.onStartAudit} /> : null}
      {a.audit === 'open' ? <PrimaryButton variant="outline" title={t('audits.actions.open')} disabled={off} onPress={p.onOpenAudit} /> : null}
      {a.correct ? <PrimaryButton variant="outline" title={t('corrections.actions.correct')} disabled={off || p.busy} onPress={p.onCorrect} /> : null}
      {a.sendBack ? <PrimaryButton variant="outline" title={t('corrections.actions.sendBack')} disabled={off || p.busy} onPress={p.onSendBack} /> : null}
      {a.withdraw ? <PrimaryButton variant="outline" title={t('corrections.actions.withdraw')} disabled={off || p.busy} onPress={p.onWithdraw} /> : null}
    </View>
  );
}

/** The open send-back request: round, due date in the tenant's time zone, and each item with its comment. */
function ReworkSummary({ rework, content, timeZone }: { rework: ReworkRequest; content: ChecklistContent; timeZone: string }) {
  const { t } = useTranslation();
  const labels = new Map<string, string>();
  walkItems(content, (item) => labels.set(item.id, item.label));
  return (
    <View testID="run-rework" style={styles.rework}>
      <Text style={styles.reworkTitle}>{`${t('corrections.reworkBanner')} · ${t('corrections.round', { round: rework.round })}`}</Text>
      {rework.dueAt ? <Text style={styles.reworkText}>{t('corrections.dueAt', { date: formatDateTime(rework.dueAt, { locale: 'az', timeZone }) })}</Text> : null}
      {rework.items.map((i) => (
        <Text key={i.itemId} style={styles.reworkText}>{`${labels.get(i.itemId) ?? t('executions.problemsPage.unknownItem')}: ${i.comment}`}</Text>
      ))}
    </View>
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
  actions: { gap: spacing.sm },
  rework: { borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7', gap: spacing.xs },
  reworkTitle: { color: '#92400E', fontWeight: '700' },
  reworkText: { color: '#92400E' },
});
