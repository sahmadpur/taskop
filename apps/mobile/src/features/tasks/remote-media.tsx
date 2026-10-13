import type { MediaKind, MediaStatus, MediaUrl } from '@taskop/contracts';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoPreview } from '@/features/execution/capture';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';

/** A medium the server holds, as `TaskMediaDto` and `ProblemDto.media` describe it (decision 12). */
export interface RemoteMedia {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
}

/** A presigned URL is replaced when it has less than this left before it expires. */
export const URL_REFRESH_MARGIN_MS = 30_000;

/**
 * Media the server holds (instructions, a problem's photos, a submission's files): presigned GET URLs, fetched while
 * online, for uploaded media only. A pending medium (not uploaded yet, or purged) is drawn as such and never signed.
 * Every medium is signed on its own, so one that fails does not hide the others (a tap tries it again); all are signed
 * again when the phone comes back online. A URL that has expired (an evicted image, a video tapped much later) is
 * signed again on the spot. A tap plays a video.
 */
export function RemoteMediaStrip({ items, load }: { items: RemoteMedia[]; load: (id: string) => Promise<MediaUrl> }) {
  const { t } = useTranslation();
  const { clock } = useOffline();
  const { online } = useSyncStatus();
  const [urls, setUrls] = useState<Record<string, MediaUrl>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const resigned = useRef(new Set<string>()); // images signed again after an error, until one loads
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const uploaded = items.filter((i) => i.status === 'uploaded');
  const key = uploaded.map((i) => i.id).join(',');

  /** Signs one medium; its URL, or null when that failed (the medium is then marked as such). */
  const sign = async (id: string, guard: () => boolean = () => alive.current): Promise<MediaUrl | null> => {
    try {
      const signed = await loadRef.current(id);
      if (guard()) {
        setUrls((u) => ({ ...u, [id]: signed }));
        setFailed((f) => without(f, id));
      }
      return signed;
    } catch {
      if (guard()) setFailed((f) => new Set(f).add(id));
      return null;
    }
  };

  useEffect(() => {
    // A new run (back online, other media) forgets earlier failures and tries everything again.
    setFailed(new Set());
    resigned.current.clear();
    if (!online || uploaded.length === 0) return;
    let current = true;
    for (const i of uploaded) void sign(i.id, () => current && alive.current);
    return () => {
      current = false;
    };
    // `key` stands for the uploaded items; `load` is a new closure on every render. The repo's ESLint has no react-hooks plugin.
  }, [online, key]);

  const open = async (item: RemoteMedia) => {
    let signed: MediaUrl | null = urls[item.id] ?? null;
    if (!signed || Date.parse(signed.expiresAt) - clock.now() < URL_REFRESH_MARGIN_MS) signed = (await sign(item.id)) ?? signed;
    if (signed && item.kind === 'video' && alive.current) setPlaying(signed.url);
  };
  const imageFailed = (id: string) => {
    if (!resigned.current.has(id)) {
      resigned.current.add(id);
      void sign(id);
    }
  };

  if (items.length === 0) return null;
  if (!online && uploaded.length > 0 && Object.keys(urls).length === 0) return <Text style={styles.muted}>{t('mobile.tasks.detail.mediaOffline')}</Text>;
  return (
    <View style={styles.strip}>
      {items.map((item, n) => {
        const kind = t(`executions.mediaKinds.${item.kind}`);
        if (item.status === 'pending') {
          return (
            <View key={item.id} testID={`pending-${item.id}`} accessibilityLabel={t('executions.media.pendingLabel', { kind })} style={styles.thumb}>
              <Text style={styles.pending}>{t('executions.media.pending')}</Text>
            </View>
          );
        }
        const url = urls[item.id]?.url;
        return (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${kind} ${n + 1}`} onPress={() => void open(item)} style={styles.thumb}>
            {failed.has(item.id) && !url ? (
              <Text testID={`failed-${item.id}`} style={styles.pending}>
                {t('mobile.tasks.detail.mediaFailed')}
              </Text>
            ) : !url ? (
              <ActivityIndicator color={colors.primary} />
            ) : item.kind === 'photo' ? (
              <Image
                testID={`remote-${item.id}`}
                source={{ uri: url }}
                style={styles.image}
                onLoad={() => resigned.current.delete(item.id)}
                onError={() => imageFailed(item.id)}
              />
            ) : (
              <Text testID={`remote-${item.id}`} style={styles.play}>
                ▶
              </Text>
            )}
          </Pressable>
        );
      })}
      {playing ? <VideoPreview uri={playing} onClose={() => setPlaying(null)} /> : null}
    </View>
  );
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: 72, height: 72 },
  play: { fontSize: 24, color: colors.text },
  pending: { fontSize: 12, color: colors.muted, textAlign: 'center', padding: spacing.xs },
  muted: { color: colors.muted },
});
