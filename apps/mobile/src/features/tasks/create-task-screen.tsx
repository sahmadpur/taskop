import { ApiError } from '@taskop/api-client';
import {
  DEFAULT_TASK_EVIDENCE,
  EVIDENCE_LEVELS,
  type EvidenceLevel,
  MEDIA_KINDS,
  type MediaKind,
  TASK_LIMITS,
  TASK_PRIORITIES,
  type TaskAssignee,
  type TaskAssigneeOptions,
  type TaskEvidence,
  type TaskPriority,
} from '@taskop/contracts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { CaptureModal, pickFromGallery } from '@/features/execution/capture';
import { toAnswerDatetime } from '@/features/execution/datetime-format';
import { CaptureError } from '@/features/execution/media-capture';
import { Chip, Choice } from '@/features/execution/parts';
import { api, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import type { CapturedMedia } from '@/offline/execution-store';
import { useSyncStatus } from '@/offline/hooks';
import { ScreenHeader } from './screen-header';

const ASSIGNEE_SEARCH_DELAY_MS = 300;

const withLevel = (e: TaskEvidence, kind: MediaKind, level: EvidenceLevel): TaskEvidence => (kind === 'photo' ? { ...e, photo: level } : { ...e, video: level });

/** Spec §7.2: a tasks.manage holder creates a task on the phone. Creating needs a connection (spec §1). */
export function CreateTaskScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const { online } = useSyncStatus();
  const session = useSession();
  const canManage = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
  // One client id per screen: a retry after a lost connection repeats the same idempotent POST (decision 10).
  const [id] = useState(() => services.newId());
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<TaskAssigneeOptions | null>(null);
  const [assignee, setAssignee] = useState<{ value: TaskAssignee; key: string } | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [requiresReview, setRequiresReview] = useState(false);
  const [evidence, setEvidence] = useState<TaskEvidence>(DEFAULT_TASK_EVIDENCE);
  const [photos, setPhotos] = useState<CapturedMedia[]>([]);
  const [camera, setCamera] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Closes the same-tick double press and the window between a successful create and the screen closing.
  const inFlight = useRef(false);
  const created = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    if (!online || !canManage) return;
    let alive = true;
    const timer = setTimeout(() => {
      const term = q.trim();
      api.tasks.assignees(term ? { q: term } : {}).then(
        (o) => {
          if (alive) setOptions(o);
        },
        (e: unknown) => {
          if (alive) setError(mobileErrorText(t, e));
        },
      );
    }, ASSIGNEE_SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [online, canManage, q, t]);

  const removeFile = (uri: string) => {
    try {
      services.files.remove(uri);
    } catch {
      // Already gone.
    }
  };
  // Photos taken for a task that was never created are deleted when the screen closes (decision 10).
  useEffect(
    () => () => {
      if (!created.current) photosRef.current.forEach((p) => removeFile(p.localUri));
    },
    // Runs once on unmount; `removeFile` only reads `services`.
    [services],
  );

  if (!canManage) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.create.title')} />
        <Text style={styles.muted}>{t('errors.FORBIDDEN')}</Text>
      </Screen>
    );
  }

  if (!online) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.create.title')} />
        <Text style={styles.muted}>{t('mobile.tasks.online')}</Text>
      </Screen>
    );
  }

  const fieldError = (key: string) => (fields[key] ? t(fields[key]) : null);
  const pick = (value: TaskAssignee, key: string) => {
    setAssignee({ value, key });
    setFields(({ assignee: _cleared, ...rest }) => rest);
  };
  const pickPhoto = async () => {
    try {
      const picked = await pickFromGallery('photo');
      if (picked) setPhotos((xs) => [...xs, picked]);
    } catch (e) {
      Alert.alert(e instanceof CaptureError ? t(`mobile.evidence.${e.problem}`) : t('mobile.evidence.failed'));
    }
  };
  const removePhoto = (p: CapturedMedia) => {
    setPhotos((xs) => xs.filter((x) => x !== p));
    removeFile(p.localUri);
  };

  const save = async () => {
    if (inFlight.current) return;
    setError(null);
    const dueAt = due.trim() ? toAnswerDatetime('datetime', due) : null;
    const invalid: Record<string, string> = {};
    if (!title.trim()) invalid.title = 'mobile.tasks.create.titleRequired';
    if (!assignee) invalid.assignee = 'mobile.tasks.create.assigneeRequired';
    if (due.trim() && !dueAt) invalid.dueAt = 'mobile.execution.invalidDate';
    setFields(invalid);
    if (!assignee || Object.keys(invalid).length > 0) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await api.tasks.create({ id, title: title.trim(), instructions: instructions.trim(), priority, siteId, dueAt, evidence, requiresReview, assignee: assignee.value });
      created.current = true;
      if (photos.length > 0) await services.tasks.queueInstructionMedia(id, photos);
      Alert.alert(t('mobile.tasks.create.created'));
      setDone(true);
      router.back();
    } catch (e) {
      inFlight.current = false;
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const full = photos.length >= TASK_LIMITS.instructionMedia;
  return (
    <Screen>
      <ScreenHeader title={t('mobile.tasks.create.title')} />
      <Field label={t('mobile.tasks.create.name')} value={title} onChangeText={setTitle} error={fieldError('title')} />
      <Text style={styles.label}>{t('mobile.tasks.create.instructions')}</Text>
      <TextInput
        accessibilityLabel={t('mobile.tasks.create.instructions')}
        value={instructions}
        onChangeText={setInstructions}
        multiline
        maxLength={TASK_LIMITS.instructionsMax}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={styles.label}>{t('mobile.tasks.create.priority')}</Text>
      <View style={styles.row}>
        {TASK_PRIORITIES.map((p) => (
          <Choice key={p} role="radio" label={t(`tasks.priorities.${p}`)} selected={priority === p} onPress={() => setPriority(p)} />
        ))}
      </View>

      <Text style={styles.label}>{t('mobile.tasks.create.assignee')}</Text>
      <Field label={t('mobile.tasks.create.search')} value={q} onChangeText={setQ} autoCapitalize="none" />
      <FormError message={fieldError('assignee')} />
      {options && options.teams.length > 0 ? <Text style={styles.muted}>{t('mobile.tasks.create.teams')}</Text> : null}
      <View style={styles.row}>
        {options?.teams.map((team) => (
          <Choice
            key={team.id}
            role="radio"
            label={t('mobile.tasks.create.teamOption', { name: team.name, count: team.memberCount })}
            selected={assignee?.key === `t:${team.id}`}
            onPress={() => pick({ teamId: team.id }, `t:${team.id}`)}
          />
        ))}
      </View>
      {options && options.users.length > 0 ? <Text style={styles.muted}>{t('mobile.tasks.create.people')}</Text> : null}
      <View style={styles.row}>
        {options?.users.map((u) => (
          <Choice
            key={u.id}
            role="radio"
            label={u.jobTitle ? `${u.fullName} · ${u.jobTitle}` : u.fullName}
            selected={assignee?.key === `u:${u.id}`}
            onPress={() => pick({ userId: u.id }, `u:${u.id}`)}
          />
        ))}
      </View>

      {/* Active sites writable in the caller's scope, unaffected by the search (decision 17). */}
      {options && options.sites.length > 0 ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.create.site')}</Text>
          <View style={styles.row}>
            <Choice role="radio" label={t('mobile.tasks.create.noSite')} selected={siteId === null} onPress={() => setSiteId(null)} />
            {options.sites.map((site) => (
              <Choice key={site.id} role="radio" label={site.name} selected={siteId === site.id} onPress={() => setSiteId(site.id)} />
            ))}
          </View>
          <FormError message={fieldError('siteId')} />
        </>
      ) : null}

      <Field label={t('mobile.tasks.create.due')} value={due} onChangeText={setDue} error={fieldError('dueAt')} autoCapitalize="none" />
      <Choice role="checkbox" label={t('mobile.tasks.create.review')} selected={requiresReview} onPress={() => setRequiresReview((v) => !v)} />

      <Text style={styles.label}>{t('mobile.tasks.create.evidence')}</Text>
      {MEDIA_KINDS.map((kind) => (
        <View key={kind} testID={`evidence-${kind}`} style={styles.evidence}>
          <Text style={styles.muted}>{t(`executions.mediaKinds.${kind}`)}</Text>
          <View style={styles.row}>
            {EVIDENCE_LEVELS.map((level) => (
              <Choice
                key={level}
                role="radio"
                label={t(`tasks.evidenceLevels.${level}`)}
                selected={evidence[kind] === level}
                onPress={() => setEvidence((e) => withLevel(e, kind, level))}
              />
            ))}
          </View>
        </View>
      ))}
      <Choice role="checkbox" label={t('mobile.evidence.liveOnly')} selected={evidence.liveOnly} onPress={() => setEvidence((e) => ({ ...e, liveOnly: !e.liveOnly }))} />

      <Text style={styles.label}>{t('mobile.tasks.create.photos')}</Text>
      <View style={styles.row}>
        {photos.map((p, n) => (
          <Pressable
            key={p.localUri}
            testID={`instruction-${n}`}
            accessibilityRole="button"
            accessibilityLabel={`${t('executions.mediaKinds.photo')} ${n + 1}`}
            onLongPress={() => removePhoto(p)}
            style={styles.thumb}
          >
            <Image source={{ uri: p.localUri }} style={styles.thumb} />
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Chip label={`${t('executions.mediaKinds.photo')}: ${t('mobile.evidence.camera')}`} disabled={full} onPress={() => setCamera(true)} />
        <Chip label={`${t('executions.mediaKinds.photo')}: ${t('mobile.evidence.gallery')}`} disabled={full} onPress={() => void pickPhoto()} />
      </View>

      <FormError message={error} />
      <PrimaryButton title={t('mobile.tasks.create.save')} onPress={() => void save()} disabled={busy || done} />
      {camera ? (
        <CaptureModal
          kind="photo"
          onClose={() => setCamera(false)}
          onCaptured={(m) => {
            setCamera(false);
            setPhotos((xs) => [...xs, m]);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  evidence: { gap: spacing.xs },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  thumb: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
});
