import { MEDIA_LIMITS, type MediaKind, type MediaSource } from '@taskop/contracts';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { getRandomBytes } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import type { CapturedMedia } from '@/offline/execution-store';
import { uuidv7 } from '@/offline/ids';
import { mediaDirectory } from '@/offline/native/media-files';
import { CaptureError, fileExtension, photoResize, videoMimeFor, videoProblem } from './media-capture';

/** Moves a captured file out of the cache (which the OS may clear) into documents/media/<uuidv7>.<ext>. */
export function persistCapture(m: CapturedMedia): CapturedMedia {
  const source = new File(m.localUri);
  const target = new File(mediaDirectory(), `${uuidv7(Date.now(), getRandomBytes)}.${fileExtension(m.mime)}`);
  source.moveSync(target);
  return { ...m, localUri: target.uri, bytes: target.size };
}

/** Spec §1: 1600 px long edge, JPEG quality 0.7, ≤ 5 MB. Gallery PNGs are re-encoded too (decision 9). */
export async function preparePhoto(input: { uri: string; width: number; height: number }, source: MediaSource): Promise<CapturedMedia> {
  let { width, height } = input;
  if (!width || !height) {
    const probe = await ImageManipulator.manipulate(input.uri).renderAsync();
    width = probe.width;
    height = probe.height;
  }
  const context = ImageManipulator.manipulate(input.uri);
  const resize = photoResize(width, height);
  if (resize) context.resize(resize);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: MEDIA_LIMITS.jpegQuality });
  const bytes = new File(saved.uri).size;
  if (bytes > MEDIA_LIMITS.photoMaxBytes) throw new CaptureError('tooLarge');
  return persistCapture({
    kind: 'photo', source, mime: 'image/jpeg', bytes, width: saved.width, height: saved.height, durationMs: null,
    localUri: saved.uri, capturedAt: new Date().toISOString(),
  });
}

function prepareRecordedVideo(uri: string): CapturedMedia {
  const bytes = new File(uri).size;
  const problem = videoProblem({ durationMs: null, bytes, width: null, height: null });
  if (problem) throw new CaptureError(problem);
  return persistCapture({
    kind: 'video', source: 'camera', mime: videoMimeFor(uri), bytes, width: null, height: null, durationMs: null,
    localUri: uri, capturedAt: new Date().toISOString(),
  });
}

/** Never offered on live-only items: the screen shows only the camera chip there (FR-12.05–06). */
export async function pickFromGallery(kind: MediaKind): Promise<CapturedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'photo' ? ['images'] : ['videos'],
    quality: 1,
    videoMaxDuration: MEDIA_LIMITS.videoMaxSeconds,
    allowsMultipleSelection: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  if (kind === 'photo') return preparePhoto({ uri: asset.uri, width: asset.width, height: asset.height }, 'gallery');
  const video = {
    durationMs: asset.duration ? Math.round(asset.duration) : null,
    bytes: asset.fileSize ?? new File(asset.uri).size,
    width: asset.width || null,
    height: asset.height || null,
  };
  const problem = videoProblem(video);
  if (problem) throw new CaptureError(problem);
  return persistCapture({
    kind: 'video', source: 'gallery', mime: videoMimeFor(asset.uri, asset.mimeType), ...video,
    localUri: asset.uri, capturedAt: new Date().toISOString(),
  });
}

interface CaptureProps {
  kind: MediaKind;
  onCaptured: (media: CapturedMedia) => void;
  onClose: () => void;
}

/**
 * expo-camera's 16:9 `720p` is Android-only; on iOS an unavailable quality falls back to the highest one, which could be
 * 1080p and refused by the server. The iOS-supported "4:3" (640x480) always stays under the 720 px short edge.
 * Task 16 checks the real iOS resolution on a device.
 */
const VIDEO_QUALITY = Platform.OS === 'ios' ? '4:3' : '720p';

/** Full-screen camera. Video: 720p, stops by itself at 60 s (spec §1). */
export function CaptureModal({ kind, onCaptured, onClose }: CaptureProps) {
  const { t } = useTranslation();
  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsMic = kind === 'video';
  const granted = Boolean(cameraPermission?.granted && (!needsMic || micPermission?.granted));

  const fail = (e: unknown) => Alert.alert(e instanceof CaptureError ? t(`mobile.evidence.${e.problem}`) : t('mobile.evidence.failed'));

  async function takePhoto() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 1 });
      if (shot) onCaptured(await preparePhoto(shot, 'camera'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (!camera.current) return;
    if (recording) {
      camera.current.stopRecording();
      return;
    }
    setRecording(true);
    try {
      const clip = await camera.current.recordAsync({ maxDuration: MEDIA_LIMITS.videoMaxSeconds, maxFileSize: MEDIA_LIMITS.videoMaxBytes });
      if (clip) onCaptured(prepareRecordedVideo(clip.uri));
    } catch (e) {
      fail(e);
    } finally {
      setRecording(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {granted ? (
        <View style={styles.fill}>
          <CameraView ref={camera} style={styles.fill} facing="back" mode={kind === 'video' ? 'video' : 'picture'} videoQuality={VIDEO_QUALITY} />
          <SafeAreaView style={styles.bar} edges={['bottom']}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} disabled={recording || busy} />
            <PrimaryButton
              title={kind === 'photo' ? t('mobile.evidence.take') : recording ? t('mobile.evidence.stop') : t('mobile.evidence.record')}
              onPress={() => void (kind === 'photo' ? takePhoto() : toggleRecording())}
              disabled={busy}
            />
          </SafeAreaView>
        </View>
      ) : (
        <SafeAreaView style={styles.center}>
          <Text style={styles.text}>{t('mobile.evidence.cameraPermission')}</Text>
          <PrimaryButton
            title={t('mobile.evidence.grant')}
            onPress={() =>
              void (async () => {
                await requestCamera();
                if (needsMic) await requestMic();
              })()
            }
          />
          <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} />
        </SafeAreaView>
      )}
    </Modal>
  );
}

export function VideoPreview({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(uri, (p) => p.play());
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill}>
        <VideoView player={player} nativeControls contentFit="contain" style={styles.fill} />
        <View style={styles.bar}>
          <PrimaryButton title={t('common.close')} onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  text: { color: colors.text, textAlign: 'center', fontSize: 16 },
});
