import { ApiError } from '@taskop/api-client';
import { TASK_LIMITS, type TaskDetail } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';
import { RemoteMediaStrip } from './remote-media';
import { ScreenHeader } from './screen-header';

/** Spec §7.2: approve, or send back with a comment (required to reject), a task awaiting the caller's review. Online only. */
export function ReviewScreen({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { timeZone } = useOffline();
  const { online } = useSyncStatus();
  const session = useSession();
  const canManage = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comment, setComment] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Closes the same-tick double press and the window between a successful review and the screen closing.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!online || !canManage) return;
    let alive = true;
    api.tasks.get(taskId).then(
      (d) => {
        if (alive) setTask(d);
      },
      (e: unknown) => {
        if (alive) setError(mobileErrorText(t, e));
      },
    );
    return () => {
      alive = false;
    };
  }, [online, canManage, taskId, t]);

  const decide = async (decision: 'approve' | 'reject') => {
    if (inFlight.current) return;
    setError(null);
    if (decision === 'reject' && !comment.trim()) {
      setFields({ comment: 'tasks.issues.commentRequired' });
      return;
    }
    setFields({});
    inFlight.current = true;
    setBusy(true);
    try {
      await api.tasks.review(taskId, decision === 'approve' ? { decision } : { decision, comment: comment.trim() });
      Alert.alert(t(decision === 'approve' ? 'mobile.tasks.review.approved' : 'mobile.tasks.review.rejected'));
      setDone(true);
      router.back();
    } catch (e) {
      inFlight.current = false;
      if (e instanceof ApiError && e.fields) {
        setFields(e.fields);
        if (!e.fields.comment) setError(mobileErrorText(t, e));
      } else setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.review.title')} />
        <Text style={styles.muted}>{t('errors.FORBIDDEN')}</Text>
      </Screen>
    );
  }
  if (!online) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.review.title')} />
        <Text style={styles.muted}>{t('mobile.tasks.online')}</Text>
      </Screen>
    );
  }
  if (!task) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.review.title')} />
        {error ? <FormError message={error} /> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }

  const submission = task.submissions.at(-1) ?? null;
  const media = submission ? task.media.filter((m) => m.submissionId === submission.id) : [];
  const reviewable = task.canReview && task.status === 'awaiting_review';
  return (
    <Screen>
      <ScreenHeader title={task.title} />
      <Text style={styles.muted}>{task.assignee?.fullName ?? task.team?.name ?? ''}</Text>
      {task.instructions ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.detail.instructions')}</Text>
          <Text style={styles.text}>{task.instructions}</Text>
        </>
      ) : null}
      {submission ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.review.submission')}</Text>
          <Text style={styles.muted}>{formatDateTime(submission.submittedAt, { locale: 'az', timeZone })}</Text>
          {submission.text ? <Text style={styles.text}>{submission.text}</Text> : null}
          <RemoteMediaStrip items={media.map((m) => ({ id: m.id, kind: m.kind, status: m.status }))} load={(id) => api.taskMedia.url(id)} />
        </>
      ) : null}
      {reviewable ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.review.comment')}</Text>
          <TextInput
            accessibilityLabel={t('mobile.tasks.review.comment')}
            value={comment}
            onChangeText={(c) => {
              setComment(c);
              setFields({});
            }}
            multiline
            maxLength={TASK_LIMITS.commentMax}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <FormError message={fields.comment ? t(fields.comment) : null} />
          <FormError message={error} />
          <PrimaryButton title={t('mobile.tasks.review.approve')} onPress={() => void decide('approve')} disabled={busy || done} />
          <PrimaryButton variant="outline" title={t('mobile.tasks.review.reject')} onPress={() => void decide('reject')} disabled={busy || done} />
        </>
      ) : (
        <Text style={styles.muted}>{t('mobile.tasks.review.notReviewable')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  text: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
});
