import { deriveProblems, MEDIA_LIMITS, type MediaKind, type MediaSource, progress, requirements, visibleItems } from '@taskop/contracts';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/primary-button';
import { claimRejectionText } from '@/features/sync/claim-rejection';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { type CapturedMedia, ExecutionLockedError, LiveOnlyError, MediaLimitError, type MediaTarget } from '@/offline/execution-store';
import { useNow } from '@/offline/hooks';
import { CaptureModal, pickFromGallery, VideoPreview } from './capture';
import { ItemField } from './item-field';
import { CaptureError } from './media-capture';
import { type ProblemDraft, ProblemSheet } from './problem-sheet';
import { readOnlyReason, useExecution } from './use-execution';

function Centered({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.center}>{children}</SafeAreaView>;
}

/** Spec §7.3: one scrolling screen per section, progress bar, every item type, inline follow-ups, evidence, ⚑ problems. Autosaves. */
export function ExecutionScreen({ occurrenceId, focusItemId }: { occurrenceId: string; focusItemId?: string }) {
  const { t } = useTranslation();
  const { store, userId } = useOffline();
  const data = useExecution(occurrenceId);
  const now = useNow();
  const [sectionIndex, setSectionIndex] = useState(0);
  const [capture, setCapture] = useState<{ kind: MediaKind; target: MediaTarget; session: number } | null>(null);
  const [draft, setDraft] = useState<ProblemDraft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const focused = useRef(false);
  // Read by work that outlives a render (a gallery pick, a camera capture): the execution's id can change meanwhile.
  const executionIdRef = useRef<string | null>(null);
  executionIdRef.current = data?.execution.id ?? null;
  // The open problem draft, kept current synchronously, and which opening of the sheet it belongs to.
  const draftRef = useRef<ProblemDraft | null>(null);
  const draftSession = useRef(0);
  const content = data?.content.kind === 'ok' ? data.content.content : null;
  const answers = data?.execution.answers;

  // A jump from the finish screen opens the item's section; the item's onLayout then scrolls to it.
  useEffect(() => {
    if (!content || !answers || !focusItemId) return;
    const target = visibleItems(content, answers).find((v) => v.item.id === focusItemId);
    const index = target ? content.sections.findIndex((s) => s.id === target.sectionId) : -1;
    if (index >= 0) setSectionIndex(index);
    // Only when the target changes or the content first arrives, not on every answer.
  }, [content, focusItemId]);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [sectionIndex]);

  if (data === undefined) {
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} />
      </Centered>
    );
  }
  if (data === null) {
    return (
      <Centered>
        <Text style={styles.muted}>{t('mobile.execution.notFound')}</Text>
      </Centered>
    );
  }
  if (!content) {
    return (
      <Centered>
        <Text style={styles.title}>{data.content.kind === 'needsUpdate' ? t('mobile.execution.needsUpdate') : t('mobile.checklists.startBlocked.notDownloaded')}</Text>
        {data.content.kind === 'needsUpdate' ? <Text style={styles.muted}>{t('mobile.execution.needsUpdateHint')}</Text> : null}
      </Centered>
    );
  }

  const { execution, occurrence } = data;
  // Always the execution's current id: it changes when the sync engine adopts my other install's claim.
  const executionId = execution.id;
  const current = execution.answers;
  const visible = visibleItems(content, current);
  const prog = progress(content, current);
  const missing = requirements(content, current);
  const problemItems = new Set(deriveProblems(content, current).map((p) => p.itemId));
  const lock = readOnlyReason(execution, occurrence, userId, now);
  const readOnly = lock !== null;
  const index = Math.min(sectionIndex, content.sections.length - 1);
  const section = content.sections[index];
  const mediaById = new Map(data.media.map((m) => [m.id, m]));
  const draftItem = draft ? (visible.find((v) => v.item.id === draft.itemId)?.item ?? null) : null;
  const banner =
    lock === 'rejected'
      ? claimRejectionText(t, execution.rejectedReason ?? 'ALREADY_CLAIMED', execution.rejectedBy)
      : lock === 'claimedByOther'
        ? claimRejectionText(t, 'ALREADY_CLAIMED', occurrence.claim?.executorName ?? null)
        : lock === 'completed'
          ? t('mobile.execution.completedBanner')
          : lock === 'locked'
            ? t('mobile.execution.locked')
            : null;

  const report = (e: unknown) => {
    if (e instanceof ExecutionLockedError) return; // the banner already says why
    if (e instanceof MediaLimitError || e instanceof LiveOnlyError) Alert.alert(t('mobile.evidence.limitReached'));
    else if (e instanceof CaptureError) Alert.alert(t(`mobile.evidence.${e.problem}`));
    else Alert.alert(t('mobile.evidence.failed'));
  };
  const run = (job: () => Promise<unknown>) => void job().catch(report);
  const updateDraft = (d: ProblemDraft | null) => {
    draftRef.current = d;
    setDraft(d);
  };
  const openDraft = (d: ProblemDraft) => {
    draftSession.current += 1;
    updateDraft(d);
  };
  const endDraft = () => {
    draftSession.current += 1; // a pick still running for this draft is discarded when it resolves
    updateDraft(null);
  };
  /** `session` is the problem sheet opening a pick was started from. */
  const attach = async (m: CapturedMedia, target: MediaTarget, session: number) => {
    const at = executionIdRef.current;
    if (!at) return;
    const id = await store.attachMedia(at, m, target);
    if (target.field !== 'problem') return;
    const d = draftRef.current;
    if (session !== draftSession.current || !d || d.itemId !== target.itemId || d.mediaIds.length >= MEDIA_LIMITS.problemMaxMedia) {
      // Its sheet was closed, another item's sheet is open, or the draft filled up meanwhile.
      await store.removeMedia(executionIdRef.current ?? at, id);
      return;
    }
    updateDraft({ ...d, mediaIds: [...d.mediaIds, id] });
  };
  const startCapture = (kind: MediaKind, source: MediaSource, target: MediaTarget) => {
    const session = draftSession.current;
    if (source === 'camera') {
      setCapture({ kind, target, session });
      return;
    }
    run(async () => {
      const picked = await pickFromGallery(kind);
      if (picked) await attach(picked, target, session);
    });
  };
  // Problem media are registered as they are attached; those the worker drops from the problem are removed again
  // (a medium the server never registered is forgotten entirely), so nothing unused is uploaded.
  const discard = (ids: string[]) => {
    for (const id of ids) run(() => store.removeMedia(executionId, id));
  };
  const savedProblemMedia = (itemId: string) => current[itemId]?.problem?.mediaIds ?? [];
  const closeDraft = (d: ProblemDraft) => {
    endDraft();
    const saved = savedProblemMedia(d.itemId);
    discard(d.mediaIds.filter((id) => !saved.includes(id)));
  };
  const confirmRemove = (mediaId: string) =>
    Alert.alert(t('mobile.evidence.removeTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.evidence.remove'), style: 'destructive', onPress: () => run(() => store.removeMedia(executionId, mediaId)) },
    ]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {occurrence.checklistName}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {occurrence.siteName}
          </Text>
        </View>
        <SyncIndicator />
      </View>
      <View style={styles.progressWrap}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${prog.total ? Math.round((prog.answered / prog.total) * 100) : 0}%` }]} />
        </View>
        <Text style={styles.muted}>{t('mobile.execution.progress', { answered: prog.answered, total: prog.total })}</Text>
      </View>
      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}
      <ScrollView
        testID="execution-scroll"
        ref={scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {section ? (
          <>
            <Text style={styles.muted}>{t('mobile.execution.section', { n: index + 1, total: content.sections.length })}</Text>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.instructions ? <Text style={styles.muted}>{section.instructions}</Text> : null}
            {visible
              .filter((v) => v.sectionId === section.id)
              .map(({ item, depth }) => (
                <View
                  key={item.id}
                  style={{ marginLeft: depth * spacing.md }}
                  onLayout={(e) => {
                    if (item.id !== focusItemId || focused.current) return;
                    focused.current = true; // once: later re-layouts (answers, follow-ups) must not pull the worker back
                    scroll.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true });
                  }}
                >
                  <ItemField
                    item={item}
                    answer={current[item.id]}
                    missing={missing.filter((m) => m.itemId === item.id)}
                    hasProblem={problemItems.has(item.id)}
                    readOnly={readOnly}
                    media={mediaById}
                    onPatch={(patch) => run(() => store.patchAnswer(executionId, item.id, patch))}
                    onCapture={(kind, source) => startCapture(kind, source, { itemId: item.id, field: 'evidence' })}
                    onRemoveMedia={confirmRemove}
                    onOpenVideo={setPreview}
                    onFlag={() => {
                      const p = current[item.id]?.problem;
                      openDraft({ itemId: item.id, severity: p?.severity ?? 'normal', note: p?.note ?? '', mediaIds: p?.mediaIds ?? [] });
                    }}
                  />
                </View>
              ))}
          </>
        ) : null}
        <View style={styles.pager}>
          <PrimaryButton variant="outline" title={t('mobile.execution.previous')} disabled={index === 0} onPress={() => setSectionIndex(index - 1)} />
          {index < content.sections.length - 1 ? (
            <PrimaryButton title={t('mobile.execution.next')} onPress={() => setSectionIndex(index + 1)} />
          ) : (
            <PrimaryButton title={t('mobile.execution.finish')} onPress={() => router.push({ pathname: '/execution/[id]/finish', params: { id: occurrenceId } })} />
          )}
        </View>
      </ScrollView>
      {draft && draftItem && !capture && !readOnly ? (
        <ProblemSheet
          draft={draft}
          itemLabel={draftItem.label}
          liveOnly={draftItem.evidence.liveOnly}
          media={mediaById}
          existing={Boolean(current[draft.itemId]?.problem)}
          onChange={updateDraft}
          onCapture={(kind, source) => startCapture(kind, source, { itemId: draft.itemId, field: 'problem' })}
          onSave={(problem) =>
            run(async () => {
              const dropped = [...new Set([...savedProblemMedia(draft.itemId), ...draft.mediaIds])].filter((id) => !problem?.mediaIds.includes(id));
              await store.setProblem(executionId, draft.itemId, problem);
              endDraft();
              discard(dropped);
            })
          }
          onClose={() => closeDraft(draft)}
        />
      ) : null}
      {capture ? (
        <CaptureModal
          kind={capture.kind}
          onClose={() => setCapture(null)}
          onCaptured={(m) => {
            const { target, session } = capture;
            setCapture(null);
            run(() => attach(m, target, session));
          }}
        />
      ) : null}
      {preview ? <VideoPreview uri={preview} onClose={() => setPreview(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  muted: { color: colors.muted },
  progressWrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.primary },
  banner: { marginHorizontal: spacing.md, borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7' },
  bannerText: { color: '#92400E' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg * 2 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  pager: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md },
});
