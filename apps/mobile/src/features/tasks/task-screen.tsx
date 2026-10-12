import { MEDIA_KINDS, type MediaKind, type MediaSource, TASK_LIMITS, taskEvidenceMet } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CommitInput } from '@/components/commit-input';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { CaptureModal, pickFromGallery, VideoPreview } from '@/features/execution/capture';
import { CaptureError } from '@/features/execution/media-capture';
import { EvidenceRow } from '@/features/execution/parts';
import { fileNotAcceptedText, notAcceptedText } from '@/features/sync/refusal-text';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { LiveOnlyError, MediaLimitError } from '@/offline/execution-store';
import { useLiveQuery, useNow } from '@/offline/hooks';
import { mediaErrorKey } from '@/offline/media-queue';
import { canEditDraft, isTaskOverdue, RESPONSE_LIMITS, TaskStateError } from '@/offline/task-store';
import { RemoteMediaStrip } from './remote-media';
import { ScreenHeader } from './screen-header';
import { Badge } from './task-row';

/** Spec §7.2 task detail: instructions, the problem it fixes, Qəbul et / Başla, the response, evidence chips and Tamamla. */
export function TaskScreen({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { tasks, mediaQueue, engine, timeZone } = useOffline();
  const now = useNow();
  const data = useLiveQuery(
    async (s) => {
      const task = await s.tasks.task(taskId);
      return task ? { task, media: await s.tasks.media(taskId), refusals: await s.tasks.refusals(taskId) } : null;
    },
    [taskId],
  );
  const [camera, setCamera] = useState<MediaKind | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const report = (e: unknown) => {
    if (e instanceof MediaLimitError || e instanceof LiveOnlyError) Alert.alert(t('mobile.evidence.limitReached'));
    else if (e instanceof CaptureError) Alert.alert(t(`mobile.evidence.${e.problem}`));
    else if (e instanceof TaskStateError) Alert.alert(t('errors.TASK_STATE_INVALID'));
    else Alert.alert(t('mobile.evidence.failed'));
  };
  // Autosaves run one after another and apart from `busy`; Tamamla flushes the field and waits for them.
  const flushText = useRef<(() => void) | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const saveText = (text: string) => {
    // A save after the draft stopped being editable (Tamamla, a state change) has nothing left to write.
    saves.current = saves.current.then(() => tasks.saveText(taskId, text)).catch((e: unknown) => (e instanceof TaskStateError ? undefined : report(e)));
  };
  const run = (job: () => Promise<unknown>) => {
    setBusy(true);
    void job()
      .catch(report)
      .finally(() => setBusy(false));
  };

  if (data === undefined) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }
  if (data === null) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.title')} />
        <Text style={styles.muted}>{t('mobile.tasks.detail.notFound')}</Text>
      </Screen>
    );
  }

  const { task, media, refusals } = data;
  const s = task.server;
  const editable = canEditDraft(task);
  const draftIds = task.draft?.mediaIds ?? [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const evidence = taskEvidenceMet(s.evidence, draftIds.flatMap((id) => mediaById.get(id) ?? []));
  const failed = media.filter((m) => m.failedCode !== null && m.uploadedAt === null);
  const last = s.submissions.at(-1) ?? null;
  const rejection = task.status === 'in_progress' && last?.reviewDecision === 'rejected' ? (last.reviewComment ?? '') : null;
  const notes = [task.syncNote, task.failedKey].filter((k): k is string => k !== null).map((k) => notAcceptedText(t, k));

  const startCapture = (kind: MediaKind, source: MediaSource) => {
    if (source === 'camera') {
      setCamera(kind);
      return;
    }
    run(async () => {
      const picked = await pickFromGallery(kind);
      if (picked) await tasks.attachMedia(taskId, picked);
    });
  };
  const confirmRemove = (mediaId: string) =>
    Alert.alert(t('mobile.evidence.removeTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.evidence.remove'), style: 'destructive', onPress: () => run(() => tasks.removeMedia(taskId, mediaId)) },
    ]);
  const complete = () => {
    flushText.current?.();
    const written = saves.current;
    run(async () => {
      await written;
      const r = await tasks.submit(taskId);
      if (!r.ok) Alert.alert(r.missing.map((k) => t(`tasks.issues.${k}Required`)).join('\n'));
    });
  };

  return (
    <Screen>
      <ScreenHeader title={s.title} />
      <View style={styles.badges}>
        <Badge text={t(`tasks.statuses.${task.status}`)} />
        {isTaskOverdue(task, now) ? <Badge text={t('tasks.flags.overdue')} tone="danger" /> : null}
        {s.priority === 'high' ? <Badge text={t('tasks.priorities.high')} tone="warning" /> : null}
      </View>
      {notes.map((n) => (
        <Text key={n} style={styles.warning}>
          {n}
        </Text>
      ))}
      {rejection !== null ? <Text style={styles.warning}>{t('mobile.tasks.detail.rejected', { comment: rejection })}</Text> : null}
      {task.status === 'cancelled' && s.cancelReason ? <Text style={styles.warning}>{t('mobile.tasks.detail.cancelled', { reason: s.cancelReason })}</Text> : null}
      {s.site ? <Text style={styles.muted}>{s.site.name}</Text> : null}
      {s.team ? <Text style={styles.muted}>{t('mobile.tasks.team', { name: s.team.name })}</Text> : null}
      <Text style={styles.muted}>{s.dueAt ? t('mobile.tasks.due', { time: formatDateTime(s.dueAt, { locale: 'az', timeZone }) }) : t('mobile.tasks.noDue')}</Text>

      <Text style={styles.label}>{t('mobile.tasks.detail.instructions')}</Text>
      <Text style={styles.text}>{s.instructions || t('mobile.tasks.detail.noInstructions')}</Text>
      <RemoteMediaStrip
        items={s.media.filter((m) => m.role === 'instruction').map((m) => ({ id: m.id, kind: m.kind, status: m.status }))}
        load={(id) => api.taskMedia.url(id)}
      />

      {s.problem ? (
        <View testID="task-problem" style={styles.card}>
          <Text style={styles.label}>{t('mobile.tasks.detail.problem')}</Text>
          <Text style={styles.muted}>{`${s.problem.checklistName} · ${s.problem.siteName}`}</Text>
          {s.problem.itemLabel ? <Text style={styles.text}>{s.problem.itemLabel}</Text> : null}
          <View style={styles.badges}>
            <Badge text={t(`executions.severities.${s.problem.severity}`)} tone={s.problem.severity === 'critical' ? 'danger' : 'warning'} />
          </View>
          {s.problem.note ? <Text style={styles.text}>{s.problem.note}</Text> : null}
          <RemoteMediaStrip items={s.problem.media} load={(id) => api.tasks.problemMediaUrl(taskId, id)} />
        </View>
      ) : null}

      {task.status === 'new' || task.status === 'accepted' ? (
        <View style={styles.actions}>
          {task.status === 'new' ? (
            <PrimaryButton variant="outline" title={t('mobile.tasks.detail.accept')} onPress={() => run(() => tasks.accept(taskId))} disabled={busy} />
          ) : null}
          <PrimaryButton title={t('mobile.tasks.detail.start')} onPress={() => run(() => tasks.start(taskId))} disabled={busy} />
        </View>
      ) : null}

      {task.status === 'in_progress' || task.draft ? (
        <View style={styles.response}>
          <Text style={styles.label}>{t('mobile.tasks.detail.response')}</Text>
          <CommitInput
            accessibilityLabel={t('mobile.tasks.detail.response')}
            placeholder={t('mobile.tasks.detail.responsePlaceholder')}
            value={task.draft?.text ?? ''}
            editable={editable}
            multiline
            maxLength={TASK_LIMITS.submissionTextMax}
            flushRef={flushText}
            onCommit={saveText}
          />
          {MEDIA_KINDS.filter((kind) => s.evidence[kind] !== 'none').map((kind) => (
            <EvidenceRow
              key={kind}
              kind={kind}
              ids={draftIds.filter((id) => mediaById.get(id)?.kind === kind)}
              limit={RESPONSE_LIMITS[kind]}
              liveOnly={s.evidence.liveOnly}
              readOnly={!editable}
              media={mediaById}
              onCapture={startCapture}
              onRemove={confirmRemove}
              onOpenVideo={setVideo}
            />
          ))}
          {refusals.map((r) => (
            <Text key={r.mediaId} style={styles.error}>
              {fileNotAcceptedText(t, r.errorKey)}
            </Text>
          ))}
          {failed.map((m) => (
            <View key={m.id} style={styles.failed}>
              <Text style={styles.error}>{t(mediaErrorKey(m.failedCode ?? 'UPLOAD_FAILED'))}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('mobile.sync.discard')}: ${t(`executions.mediaKinds.${m.kind}`)}`}
                onPress={() =>
                  run(async () => {
                    await mediaQueue.discard(m.id);
                    await engine.refresh();
                  })
                }
                style={styles.discard}
              >
                <Text style={styles.discardText}>{t('mobile.sync.discard')}</Text>
              </Pressable>
            </View>
          ))}
          {editable ? (
            <>
              {evidence.ok
                ? null
                : evidence.missing.map((k) => (
                    <Text key={k} style={styles.error}>
                      {t(`tasks.issues.${k}Required`)}
                    </Text>
                  ))}
              <PrimaryButton title={t('mobile.tasks.detail.complete')} onPress={complete} disabled={busy || !evidence.ok} />
            </>
          ) : task.draft?.submittedAt ? (
            <Text style={styles.muted}>{t('mobile.tasks.detail.submitted')}</Text>
          ) : task.draft ? (
            <Text style={styles.warning}>{t('mobile.tasks.detail.readOnly')}</Text>
          ) : null}
        </View>
      ) : (task.status === 'awaiting_review' || task.status === 'completed') && last ? (
        <View style={styles.response}>
          <Text style={styles.label}>{t('mobile.tasks.detail.response')}</Text>
          <Text style={styles.muted}>{t('mobile.tasks.detail.submitted')}</Text>
          {last.text ? <Text style={styles.text}>{last.text}</Text> : null}
        </View>
      ) : null}

      {camera ? (
        <CaptureModal
          kind={camera}
          onClose={() => setCamera(null)}
          onCaptured={(m) => {
            setCamera(null);
            run(() => tasks.attachMedia(taskId, m));
          }}
        />
      ) : null}
      {video ? <VideoPreview uri={video} onClose={() => setVideo(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  text: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  warning: { color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  error: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end' },
  response: { gap: spacing.sm },
  failed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  discard: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  discardText: { color: colors.danger, fontWeight: '600' },
});
