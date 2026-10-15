import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type ExecutionDetail, sendBackInputSchema, visibleItems } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { toAnswerDatetime } from '@/features/execution/datetime-format';
import { Choice } from '@/features/execution/parts';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import type { RunCommand } from './queries';

/** An item the server no longer knows (`items.<n>.itemId`): the run changed since this screen loaded. */
const UNKNOWN_ITEM = /^items\.\d+\.itemId$/;
const hasUnknownItem = (e: ApiError) => Object.keys(e.fields ?? {}).some((k) => UNKNOWN_ITEM.test(k));
/** The refusals that mean the run moved on: the command refreshes the team queries so the screen follows. */
const staleRun = (e: ApiError) => e.code === 'EXECUTION_NOT_CORRECTABLE' || e.code === 'EXECUTION_LOCKED' || (e.code === 'VALIDATION_FAILED' && hasUnknownItem(e));

interface Props {
  detail: ExecutionDetail;
  online: boolean;
  command: RunCommand;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Spec §8.2 "Send back": pick the items to fix, a comment for each, an optional due date (typed in the phone's time
 * as on the task form, Spec decision 12), then send. The picks stay while offline; only sending needs the connection.
 */
export function SendBackMode({ detail, online, command, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  /** Picked items and their comments. */
  const [comments, setComments] = useState<ReadonlyMap<string, string>>(new Map());
  const [due, setDue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const items = visibleItems(detail.content, detail.answers);

  const toggle = (itemId: string) =>
    setComments((m) => {
      const next = new Map(m);
      if (next.has(itemId)) next.delete(itemId);
      else next.set(itemId, '');
      return next;
    });

  const send = async () => {
    setProblem(null);
    setDueError(null);
    const picked = items.filter((v) => comments.has(v.item.id)).map((v) => ({ itemId: v.item.id, comment: (comments.get(v.item.id) ?? '').trim() }));
    if (picked.length === 0) return setProblem(t('mobile.team.sendBack.noItems'));
    if (picked.some((i) => i.comment === '')) return setProblem(t('mobile.team.sendBack.commentRequired'));
    const dueAt = due.trim() ? toAnswerDatetime('datetime', due) : null;
    if (due.trim() && !dueAt) return setDueError(t('mobile.execution.invalidDate'));
    const body = sendBackInputSchema.safeParse({ items: picked, dueAt });
    if (!body.success) return setProblem(t('errors.VALIDATION_FAILED'));
    const r = await command.run(() => api.corrections.sendBack(detail.id, body.data), { refreshOnError: staleRun });
    if (!r) return;
    if (r.ok) {
      Alert.alert(t('mobile.team.sendBack.sent'));
      onDone();
      return;
    }
    const e = r.error;
    if (e instanceof ApiError && (e.code === 'EXECUTION_NOT_CORRECTABLE' || e.code === 'EXECUTION_LOCKED')) {
      // The run moved on (resubmitted, audited, already sent back) since this screen loaded: say so and reload it.
      setProblem(mobileErrorText(t, e));
    } else if (e instanceof ApiError && e.code === 'VALIDATION_FAILED' && e.fields) {
      if (e.fields.dueAt) setDueError(t(e.fields.dueAt));
      // An item that is gone from the checklist's version (`items.<n>.itemId`): the command refreshed the list.
      if (hasUnknownItem(e)) setProblem(t('executions.issues.unknownItem'));
      else if (!e.fields.dueAt) setProblem(mobileErrorText(t, e));
    } else setProblem(mobileErrorText(t, e));
  };

  return (
    <View style={styles.block}>
      <Text style={styles.title}>{t('mobile.team.sendBack.title')}</Text>
      <Text style={styles.muted}>{t('mobile.team.sendBack.pick')}</Text>
      {items.map(({ item, depth }) => {
        const picked = comments.has(item.id);
        return (
          <View key={item.id} testID={`send-back-${item.id}`} style={[styles.card, { marginLeft: depth * spacing.md }]}>
            <Choice role="checkbox" label={item.label} selected={picked} onPress={() => toggle(item.id)} />
            {picked ? (
              <TextInput
                accessibilityLabel={`${t('corrections.fields.itemComment')}: ${item.label}`}
                value={comments.get(item.id)}
                onChangeText={(text) => setComments((m) => new Map(m).set(item.id, text))}
                multiline
                maxLength={AUDIT_LIMITS.reason}
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            ) : null}
          </View>
        );
      })}
      <Field label={t('mobile.team.sendBack.due')} value={due} onChangeText={setDue} error={dueError} autoCapitalize="none" />
      <FormError message={problem} />
      {!online ? <Text style={styles.offline}>{t('mobile.team.offline')}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onCancel} />
        <PrimaryButton title={t('corrections.actions.sendBack')} disabled={!online || command.busy} onPress={() => void send()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  offline: { color: colors.muted, fontSize: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  input: { minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
