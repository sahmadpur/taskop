import type { MediaKind, MediaStatus, MediaUrl } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoPreview } from '@/features/execution/capture';
import { colors, spacing } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';

/** A medium the server holds, as `TaskMediaDto` and `ProblemDto.media` describe it (decision 12). */
export interface RemoteMedia {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
}

/**
 * Media the server holds (instructions, a problem's photos, a submission's files): presigned GET URLs, fetched while
 * online, for uploaded media only. A pending medium (not uploaded yet, or purged) is drawn as such and never signed.
 * A tap plays a video.
 */
export function RemoteMediaStrip({ items, load }: { items: RemoteMedia[]; load: (id: string) => Promise<MediaUrl> }) {
  const { t } = useTranslation();
  const { online } = useSyncStatus();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const uploaded = items.filter((i) => i.status === 'uploaded');
  const key = uploaded.map((i) => i.id).join(',');
  useEffect(() => {
    if (!online || uploaded.length === 0) return;
    let alive = true;
    Promise.all(uploaded.map(async (i) => [i.id, (await load(i.id)).url] as const)).then(
      (pairs) => {
        if (alive) setUrls(Object.fromEntries(pairs));
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
    // `key` stands for the uploaded items; `load` is a new closure on every render. The repo's ESLint has no react-hooks plugin.
  }, [online, key]);
  if (items.length === 0) return null;
  if (failed) return <Text style={styles.muted}>{t('mobile.tasks.detail.mediaFailed')}</Text>;
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
        const url = urls[item.id];
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${kind} ${n + 1}`}
            onPress={() => {
              if (url && item.kind === 'video') setPlaying(url);
            }}
            style={styles.thumb}
          >
            {!url ? (
              <ActivityIndicator color={colors.primary} />
            ) : item.kind === 'photo' ? (
              <Image testID={`remote-${item.id}`} source={{ uri: url }} style={styles.image} />
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

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: 72, height: 72 },
  play: { fontSize: 24, color: colors.text },
  pending: { fontSize: 12, color: colors.muted, textAlign: 'center', padding: spacing.xs },
  muted: { color: colors.muted },
});
