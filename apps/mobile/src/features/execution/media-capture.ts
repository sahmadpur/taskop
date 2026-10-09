import { MEDIA_LIMITS } from '@taskop/contracts';

/** Spec §1: photos are resized on the phone to a 1600 px long edge. Null when already small enough. */
export function photoResize(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= MEDIA_LIMITS.photoLongEdge) return null;
  return width >= height ? { width: MEDIA_LIMITS.photoLongEdge } : { height: MEDIA_LIMITS.photoLongEdge };
}

export type VideoMime = 'video/mp4' | 'video/quicktime';

/** iOS records .mov (QuickTime), Android .mp4; the API accepts exactly these two (MEDIA_LIMITS.mimeTypes.video). */
export function videoMimeFor(uri: string, reported?: string | null): VideoMime {
  if (reported === 'video/mp4' || reported === 'video/quicktime') return reported;
  return /\.mov$/i.test(uri) ? 'video/quicktime' : 'video/mp4';
}

export type CaptureProblem = 'tooLong' | 'tooLarge' | 'resolution';

/** The server's video limits, checked before anything is queued (decision 9). Unknown values are not judged. */
export function videoProblem(v: { durationMs: number | null; bytes: number; width: number | null; height: number | null }): CaptureProblem | null {
  if (v.durationMs !== null && v.durationMs > MEDIA_LIMITS.videoMaxSeconds * 1000) return 'tooLong';
  if (v.bytes > MEDIA_LIMITS.videoMaxBytes) return 'tooLarge';
  if (v.width && v.height && Math.min(v.width, v.height) > MEDIA_LIMITS.videoMaxShortEdge) return 'resolution';
  return null;
}

export class CaptureError extends Error {
  constructor(readonly problem: CaptureProblem) {
    super(`Media refused: ${problem}`);
    this.name = 'CaptureError';
  }
}

export const fileExtension = (mime: string): string => (MEDIA_LIMITS.extensions as Record<string, string>)[mime] ?? 'bin';
