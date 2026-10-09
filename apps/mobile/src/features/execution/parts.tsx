import type { MediaKind, MediaSource } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import type { LocalMedia } from '@/offline/local-model';

export function Choice(p: { label: string; selected: boolean; role: 'radio' | 'checkbox'; disabled?: boolean; onPress: () => void }) {
  const disabled = Boolean(p.disabled);
  return (
    <Pressable
      accessibilityRole={p.role}
      accessibilityLabel={p.label}
      accessibilityState={p.role === 'checkbox' ? { checked: p.selected, disabled } : { selected: p.selected, disabled }}
      disabled={disabled}
      onPress={p.onPress}
      style={[styles.choice, p.selected ? styles.choiceOn : null, disabled ? styles.dim : null]}
    >
      <Text style={[styles.choiceText, p.selected ? styles.choiceTextOn : null]}>{p.label}</Text>
    </Pressable>
  );
}

export function Chip(p: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ disabled: Boolean(p.disabled) }}
      disabled={p.disabled}
      onPress={p.onPress}
      style={[styles.chip, p.disabled ? styles.dim : null]}
    >
      <Text style={styles.chipText}>{p.label}</Text>
    </Pressable>
  );
}

/** Thumbnails; a long press asks to remove, a tap plays a video. Files already cleaned up after upload show "Yükləndi". */
export function MediaStrip(p: { ids: string[]; media: ReadonlyMap<string, LocalMedia>; disabled?: boolean; onRemove: (id: string) => void; onOpenVideo: (uri: string) => void }) {
  const { t } = useTranslation();
  if (p.ids.length === 0) return null;
  return (
    <View style={styles.strip}>
      {p.ids.map((id, i) => {
        const m = p.media.get(id);
        const kind = m?.kind ?? 'photo';
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={`${t(`executions.mediaKinds.${kind}`)} ${i + 1}`}
            onPress={() => {
              if (m && !m.fileDeletedAt && m.kind === 'video') p.onOpenVideo(m.localUri);
            }}
            onLongPress={() => {
              if (!p.disabled) p.onRemove(id);
            }}
            style={styles.thumb}
          >
            {!m || m.fileDeletedAt ? (
              <Text style={styles.thumbText}>{t('mobile.evidence.uploaded')}</Text>
            ) : m.kind === 'photo' ? (
              <Image source={{ uri: m.localUri }} style={styles.thumbImage} />
            ) : (
              <Text style={styles.thumbText}>▶</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Evidence of one kind: thumbnails, then camera (and gallery unless live-only) chips while under the limit. */
export function EvidenceRow(p: {
  kind: MediaKind;
  ids: string[];
  limit: number;
  liveOnly: boolean;
  readOnly: boolean;
  media: ReadonlyMap<string, LocalMedia>;
  onCapture: (kind: MediaKind, source: MediaSource) => void;
  onRemove: (id: string) => void;
  onOpenVideo: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`executions.mediaKinds.${p.kind}`);
  const open = !p.readOnly && p.ids.length < p.limit;
  return (
    <View style={styles.evidence}>
      <MediaStrip ids={p.ids} media={p.media} disabled={p.readOnly} onRemove={p.onRemove} onOpenVideo={p.onOpenVideo} />
      <View style={styles.chips}>
        {open ? <Chip label={`${label}: ${t('mobile.evidence.camera')}`} onPress={() => p.onCapture(p.kind, 'camera')} /> : null}
        {open && !p.liveOnly ? <Chip label={`${label}: ${t('mobile.evidence.gallery')}`} onPress={() => p.onCapture(p.kind, 'gallery')} /> : null}
        {p.liveOnly ? <Text style={styles.hint}>{t('mobile.evidence.liveOnly')}</Text> : null}
        <Text style={styles.hint}>{t('mobile.evidence.count', { count: p.ids.length, limit: p.limit })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: { minHeight: 44, minWidth: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceText: { color: colors.text, fontSize: 15 },
  choiceTextOn: { color: colors.primaryText, fontWeight: '600' },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.primary, fontWeight: '500' },
  dim: { opacity: 0.5 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImage: { width: 64, height: 64 },
  thumbText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  evidence: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  hint: { color: colors.muted, fontSize: 13 },
});
