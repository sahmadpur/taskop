import type { CapturedMedia } from '../execution-store';
import { T } from './fixtures';

/** In-memory stand-in for the phone's media files and the presigned PUT. */
export interface FakeTransport {
  files: Set<string>;
  uploads: { uri: string; url: string; headers: Record<string, string> }[];
  removed: string[];
  respond(fn: (uri: string) => number | Promise<number>): void;
  exists(uri: string): boolean;
  remove(uri: string): void;
  upload(uri: string, url: string, headers: Record<string, string>): Promise<number>;
}

export function createFakeTransport(): FakeTransport {
  let respond: (uri: string) => number | Promise<number> = () => 200;
  const t: FakeTransport = {
    files: new Set(),
    uploads: [],
    removed: [],
    respond: (fn) => {
      respond = fn;
    },
    exists: (uri) => t.files.has(uri),
    remove: (uri) => {
      t.removed.push(uri);
      t.files.delete(uri);
    },
    upload: async (uri, url, headers) => {
      t.uploads.push({ uri, url, headers });
      return respond(uri);
    },
  };
  return t;
}

let counter = 0;

export function capturedPhoto(t: FakeTransport, over: Partial<CapturedMedia> = {}): CapturedMedia {
  const localUri = `file:///doc/media/p${++counter}.jpg`;
  t.files.add(localUri);
  return { kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 250_000, width: 1600, height: 1200, durationMs: null, capturedAt: T.open, ...over, localUri };
}

export function capturedVideo(t: FakeTransport, over: Partial<CapturedMedia> = {}): CapturedMedia {
  const localUri = `file:///doc/media/v${++counter}.mp4`;
  t.files.add(localUri);
  return { kind: 'video', source: 'camera', mime: 'video/mp4', bytes: 8_000_000, width: 1280, height: 720, durationMs: 12_000, capturedAt: T.open, ...over, localUri };
}
