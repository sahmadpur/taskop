import { ApiError } from '@taskop/api-client';
import { type AuditDetail, type AuditItemVerdict, type AuditVerdictInput, type FinishAuditInput, missingVerdicts, visibleItems } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { ReadOnlyItem } from '@/features/execution/answer-view';
import { Badge } from '@/features/tasks/task-row';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { FinishAuditSheet } from './finish-audit-sheet';
import { type RunCommand, teamKeys, useTeamAudit } from './queries';
import { percentText } from './team-format';
import { VerdictSheet } from './verdict-sheet';

interface Props {
  viewerId: string;
  auditId: string;
  online: boolean;
  command: RunCommand;
  onClose: () => void;
}

const loadMedia = (id: string) => api.media.url(id);

const NOT_AUDITABLE = 'audits.issues.notAuditable';
const hiddenItem = (e: unknown) => e instanceof ApiError && e.fields?.itemId === NOT_AUDITABLE;

/**
 * Refusals that mean the screen shows a stale audit or run: the audit ended, the run was sent back or resubmitted since
 * it loaded, a verdict was cleared elsewhere, or the item is no longer in the current answers (`notAuditable`).
 */
const staleAudit = (e: ApiError) =>
  e.code === 'AUDIT_NOT_IN_PROGRESS' || e.code === 'AUDIT_PAUSED' || e.code === 'AUDIT_INCOMPLETE' || hiddenItem(e);

/** The server's field refusals carry strings of their own (`audits.issues.*`); anything else is the error's message. */
function auditErrorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError && e.fields) {
    const key = Object.values(e.fields).find((v) => v.startsWith('audits.issues.'));
    if (key) return t(key);
  }
  return mobileErrorText(t, e);
}

/**
 * Spec §8.2 "Audit" (FR-19.02–06): each auditable item with its answer and media, Approve in one tap, Reject with a
 * comment, the progress, and Finish once every item has a verdict (Spec decision 10). A paused audit (the run was sent
 * back) takes verdicts but cannot finish. A finished one is read-only. Offline the review stays and the buttons turn off.
 */
export function AuditPanel({ viewerId, auditId, online, command, onClose }: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const audit = useTeamAudit(viewerId, auditId, online);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const a = audit.data;

  if (!a) {
    return audit.error ? (
      <View style={styles.block}>
        <FormError message={mobileErrorText(t, audit.error)} />
        <PrimaryButton variant="outline" title={t('common.retry')} disabled={!online} onPress={() => void audit.refetch()} />
      </View>
    ) : (
      <ActivityIndicator color={colors.primary} />
    );
  }

  const content = a.execution.content;
  const verdicts = new Map(a.verdicts.map((v) => [v.itemId, v]));
  const missing = missingVerdicts(new Map(a.verdicts.map((v) => [v.itemId, v.verdict])), a.auditableItemIds);
  const editable = a.status === 'in_progress'; // a paused audit still takes verdicts (spec §3.3)
  const canFinish = editable && !a.paused && missing.length === 0;
  const auditable = new Set(a.auditableItemIds);
  const items = visibleItems(content, a.execution.answers).filter((v) => auditable.has(v.item.id));
  const problemItems = new Set(a.execution.problems.filter((p) => p.clearedAt === null).map((p) => p.itemId));
  const off = !online || command.busy;

  /** A verdict's answer goes into the cached audit: no reload per tap (Spec decision 10). */
  const store = (itemId: string, v: AuditItemVerdict | null) =>
    client.setQueryData<AuditDetail>(teamKeys.audit(viewerId, auditId), (old) =>
      old ? { ...old, verdicts: [...old.verdicts.filter((x) => x.itemId !== itemId), ...(v ? [v] : [])] } : old,
    );
  const unhighlight = (itemId: string) =>
    setHighlight((h) => {
      const next = new Set(h);
      next.delete(itemId);
      return next;
    });

  const decide = async (itemId: string, body: AuditVerdictInput): Promise<boolean> => {
    setProblem(null);
    const r = await command.run(() => api.audits.setVerdict(auditId, itemId, body), { refresh: false, refreshOnError: staleAudit });
    if (!r) return false;
    if (!r.ok) {
      setProblem(auditErrorText(t, r.error));
      if (hiddenItem(r.error)) setRejecting(null); // the audit reloads without that item
      return false;
    }
    store(itemId, r.value);
    unhighlight(itemId);
    return true;
  };
  const clear = async (itemId: string) => {
    setProblem(null);
    const r = await command.run(() => api.audits.clearVerdict(auditId, itemId), { refresh: false, refreshOnError: staleAudit });
    if (!r) return;
    if (r.ok) store(itemId, null);
    else setProblem(auditErrorText(t, r.error));
  };
  const finish = async (body: FinishAuditInput) => {
    setProblem(null);
    const r = await command.run(() => api.audits.finish(auditId, body), { refreshOnError: staleAudit });
    if (!r) return;
    setFinishing(false);
    if (r.ok) {
      Alert.alert(t('mobile.team.audit.finished')); // the refresh brings the finished audit
      return;
    }
    if (r.error instanceof ApiError && r.error.code === 'AUDIT_INCOMPLETE') setHighlight(new Set(r.error.itemIds ?? []));
    setProblem(auditErrorText(t, r.error));
  };

  return (
    <View style={styles.block}>
      <View style={styles.badges}>
        <Text style={styles.title}>{t('audits.audit')}</Text>
        <Badge text={t(`audits.statuses.${a.status}`)} tone={a.status === 'finished' ? 'success' : 'neutral'} />
      </View>
      {a.paused ? (
        <View testID="audit-paused" style={styles.paused}>
          <Text style={styles.pausedText}>{t('audits.paused')}</Text>
        </View>
      ) : null}
      {a.status === 'finished' ? (
        <View testID="audit-result" style={styles.card}>
          <Line label={t('audits.fields.result')} value={a.result ? t(`audits.results.${a.result}`) : '—'} />
          <Line label={t('audits.score')} value={percentText(t, a.score?.percent ?? null)} />
          {a.comment ? <Line label={t('audits.fields.comment')} value={a.comment} /> : null}
          <Text style={styles.muted}>{`${t(`audits.reportStatuses.${a.reportStatus}`)} · ${t('mobile.team.audit.reportOnWeb')}`}</Text>
        </View>
      ) : (
        <Text style={styles.muted}>{t('audits.progress', { reviewed: a.auditableItemIds.length - missing.length, total: a.auditableItemIds.length })}</Text>
      )}
      {items.map(({ item, depth }) => {
        const v = verdicts.get(item.id);
        return (
          <View key={item.id} testID={`audit-item-${item.id}`} style={[styles.item, { marginLeft: depth * spacing.md }, highlight.has(item.id) ? styles.itemMissing : null]}>
            <ReadOnlyItem item={item} answer={a.execution.answers[item.id]} media={a.execution.media} flagged={problemItems.has(item.id)} load={loadMedia} />
            <View style={styles.badges}>
              <Badge
                text={v ? t(`audits.verdicts.${v.verdict}`) : t('audits.verdicts.unreviewed')}
                tone={v?.verdict === 'approved' ? 'success' : v?.verdict === 'rejected' ? 'danger' : 'neutral'}
              />
            </View>
            {v?.comment ? <Text style={styles.value}>{v.comment}</Text> : null}
            {editable ? (
              <View style={styles.actions}>
                <PrimaryButton
                  variant={v?.verdict === 'approved' ? 'primary' : 'outline'}
                  title={t('audits.actions.approve')}
                  accessibilityLabel={`${t('audits.actions.approve')}: ${item.label}`}
                  disabled={off}
                  onPress={() => void decide(item.id, { verdict: 'approved' })}
                />
                <PrimaryButton
                  variant={v?.verdict === 'rejected' ? 'primary' : 'outline'}
                  title={t('audits.actions.reject')}
                  accessibilityLabel={`${t('audits.actions.reject')}: ${item.label}`}
                  disabled={off}
                  onPress={() => setRejecting(item.id)}
                />
                {v ? (
                  <PrimaryButton
                    variant="outline"
                    title={t('audits.actions.clearVerdict')}
                    accessibilityLabel={`${t('audits.actions.clearVerdict')}: ${item.label}`}
                    disabled={off}
                    onPress={() => void clear(item.id)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      <FormError message={problem} />
      {!online ? <Text style={styles.offline}>{t('mobile.team.offline')}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton variant="outline" title={t('common.close')} onPress={onClose} />
        {editable ? <PrimaryButton title={t('audits.actions.finish')} disabled={off || !canFinish} onPress={() => setFinishing(true)} /> : null}
      </View>
      {rejecting ? (
        <VerdictSheet
          itemLabel={items.find((x) => x.item.id === rejecting)?.item.label ?? ''}
          initial={verdicts.get(rejecting)?.comment ?? ''}
          online={online}
          busy={command.busy}
          serverError={problem}
          onSave={(comment) =>
            void decide(rejecting, { verdict: 'rejected', comment }).then((ok) => {
              if (ok) setRejecting(null);
            })
          }
          onClose={() => setRejecting(null)}
        />
      ) : null}
      {finishing ? (
        <FinishAuditSheet reportEmails={a.checklistReportEmails} online={online} busy={command.busy} onSave={(body) => void finish(body)} onClose={() => setFinishing(false)} />
      ) : null}
    </View>
  );
}

/** A label and its value, read out as one. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  offline: { color: colors.muted, fontSize: 16 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  paused: { borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7' },
  pausedText: { color: '#92400E', fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  item: { borderRadius: 14, borderWidth: 2, borderColor: colors.border, padding: spacing.xs, gap: spacing.sm },
  itemMissing: { borderColor: colors.warning },
  line: { gap: 2 },
  label: { fontWeight: '600', color: colors.text },
  value: { color: colors.text, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
});
