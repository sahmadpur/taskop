import { ApiError } from '@taskop/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaFileIssue, mediaKindOfMime, type PendingMedia, prepareFiles, uploadInstructionMedia } from './media-files';

const mocks = vi.hoisted(() => ({ api: { tasks: { registerMedia: vi.fn() }, taskMedia: { confirmUploaded: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

const MB = 1024 * 1024;
const photoMeta = { width: 1600, height: 1200, durationMs: null };
/** A server timestamp well after any file is picked, so it never lowers capturedAt unless a test says so. */
const LATER = '2099-01-01T00:00:00.000Z';
const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type });
const ticket = (id: string) => ({
  mediaId: id,
  status: 'pending',
  uploadUrl: `http://files.test/${id}`,
  headers: { 'Content-Type': 'image/jpeg' },
  expiresAt: '2026-11-02T04:15:00.000Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('instruction media files', () => {
  it('accepts JPEG, PNG, MP4 and MOV within MEDIA_LIMITS and names the problem otherwise', () => {
    expect(mediaKindOfMime('image/png')).toBe('photo');
    expect(mediaKindOfMime('video/quicktime')).toBe('video');
    expect(mediaKindOfMime('image/gif')).toBeNull();
    expect(mediaFileIssue('photo', 5 * MB, photoMeta)).toBeNull();
    expect(mediaFileIssue('photo', 5 * MB + 1, photoMeta)).toBe('tasks.dialog.photoTooLarge');
    expect(mediaFileIssue('video', 10 * MB, { width: 1280, height: 720, durationMs: 60_000 })).toBeNull();
    expect(mediaFileIssue('video', 10 * MB, { width: 1920, height: 1080, durationMs: 10_000 })).toBe('tasks.dialog.videoTooLarge');
    expect(mediaFileIssue('video', 10 * MB, { width: 1280, height: 720, durationMs: 60_001 })).toBe('tasks.dialog.videoTooLarge');
    expect(mediaFileIssue('video', 60 * MB + 1, { width: 1280, height: 720, durationMs: 1000 })).toBe('tasks.dialog.videoTooLarge');
  });

  it('refuses wrong types, unreadable files and files beyond the room left, without reading or sending them', async () => {
    const read = vi.fn(async (f: File) => {
      if (f.name === 'broken.jpg') throw new Error('decode');
      return photoMeta;
    });
    const prepared = await prepareFiles([file('a.jpg', 'image/jpeg'), file('b.gif', 'image/gif'), file('broken.jpg', 'image/jpeg'), file('c.png', 'image/png')], 1, read);
    expect(prepared.map((p) => [p.file.name, p.state, p.error])).toEqual([
      ['a.jpg', 'waiting', null],
      ['b.gif', 'refused', 'errors.MEDIA_TYPE_INVALID'],
      ['broken.jpg', 'refused', 'errors.MEDIA_TYPE_INVALID'],
      ['c.png', 'refused', 'tasks.dialog.mediaLimit'],
    ]);
    expect(prepared[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('registers, uploads and confirms each waiting file, and reports failures without stopping', async () => {
    const prepared = await prepareFiles([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')], 5, async () => photoMeta);
    const [a, b] = prepared as [PendingMedia, PendingMedia];
    mocks.api.tasks.registerMedia.mockImplementation(async (_task: string, body: { id: string }) => ticket(body.id));
    mocks.api.taskMedia.confirmUploaded.mockResolvedValue({ mediaId: a.id, status: 'uploaded', uploadedAt: '2026-11-02T04:01:00.000Z' });
    // Storage refuses the second PUT (for example an expired URL).
    const put = vi.fn(async (url: string) => new Response(null, { status: url.endsWith(b.id) ? 403 : 200 }));
    vi.stubGlobal('fetch', put);
    const changes: Array<[string, Partial<PendingMedia>]> = [];
    expect(await uploadInstructionMedia('t1', prepared, LATER, (id, patch) => changes.push([id, patch]))).toBe(1);
    expect(mocks.api.tasks.registerMedia).toHaveBeenCalledWith('t1', {
      id: a.id,
      role: 'instruction',
      kind: 'photo',
      source: 'gallery',
      mime: 'image/jpeg',
      bytes: 10,
      width: 1600,
      height: 1200,
      durationMs: null,
      capturedAt: a.capturedAt,
    });
    expect(put).toHaveBeenCalledWith(`http://files.test/${a.id}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: a.file });
    expect(mocks.api.taskMedia.confirmUploaded).toHaveBeenCalledTimes(1);
    expect(mocks.api.taskMedia.confirmUploaded).toHaveBeenCalledWith(a.id);
    expect(changes).toEqual([
      [a.id, { state: 'uploading', error: null }],
      [a.id, { state: 'done' }],
      [b.id, { state: 'uploading', error: null }],
      [b.id, { state: 'failed', error: 'tasks.dialog.uploadError' }],
    ]);
  });

  it('skips files that are done or refused, skips the PUT of a stored medium, and shows the web text for a full task', async () => {
    const [a, b] = (await prepareFiles([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')], 5, async () => photoMeta)) as [PendingMedia, PendingMedia];
    mocks.api.tasks.registerMedia
      .mockResolvedValueOnce({ mediaId: a.id, status: 'uploaded', uploadUrl: null, headers: {}, expiresAt: null })
      .mockRejectedValueOnce(new ApiError(409, 'MEDIA_LIMIT_REACHED', 'errors.MEDIA_LIMIT_REACHED'));
    mocks.api.taskMedia.confirmUploaded.mockResolvedValue({ mediaId: a.id, status: 'uploaded', uploadedAt: '2026-11-02T04:01:00.000Z' });
    const put = vi.fn();
    vi.stubGlobal('fetch', put);
    const changes: Array<[string, Partial<PendingMedia>]> = [];
    const items: PendingMedia[] = [a, { ...b, state: 'failed', error: 'tasks.dialog.uploadError' }, { ...b, id: 'done1', state: 'done' }, { ...b, id: 'no1', state: 'refused' }];
    expect(await uploadInstructionMedia('t1', items, LATER, (id, patch) => changes.push([id, patch]))).toBe(1);
    expect(put).not.toHaveBeenCalled();
    expect(mocks.api.tasks.registerMedia).toHaveBeenCalledTimes(2);
    expect(changes.at(-1)).toEqual([b.id, { state: 'failed', error: 'tasks.dialog.uploadLimit' }]);
  });

  it('names a wrong computer clock with the web text, not the phone text', async () => {
    const [a] = (await prepareFiles([file('a.jpg', 'image/jpeg')], 5, async () => photoMeta)) as [PendingMedia];
    mocks.api.tasks.registerMedia.mockRejectedValueOnce(new ApiError(422, 'CLOCK_INVALID', 'errors.CLOCK_INVALID'));
    const changes: Array<[string, Partial<PendingMedia>]> = [];
    expect(await uploadInstructionMedia('t1', [a], LATER, (id, patch) => changes.push([id, patch]))).toBe(1);
    expect(changes.at(-1)).toEqual([a.id, { state: 'failed', error: 'tasks.dialog.uploadClock' }]);
  });

  it('keeps other API reasons as the API sent them', async () => {
    const [a] = (await prepareFiles([file('a.jpg', 'image/jpeg')], 5, async () => photoMeta)) as [PendingMedia];
    mocks.api.tasks.registerMedia.mockRejectedValueOnce(new ApiError(409, 'MEDIA_TOO_LARGE', 'errors.MEDIA_TOO_LARGE'));
    const changes: Array<[string, Partial<PendingMedia>]> = [];
    await uploadInstructionMedia('t1', [a], LATER, (id, patch) => changes.push([id, patch]));
    expect(changes.at(-1)).toEqual([a.id, { state: 'failed', error: 'errors.MEDIA_TOO_LARGE' }]);
  });

  it("never sends a capturedAt later than the server's own timestamp for the task (a laptop clock ahead)", async () => {
    const [a, b] = (await prepareFiles([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')], 5, async () => photoMeta)) as [PendingMedia, PendingMedia];
    // The laptop picked the files "at" a time ahead of the server.
    const ahead = { ...a, capturedAt: '2026-11-02T04:30:00.000Z' };
    const behind = { ...b, capturedAt: '2026-11-02T03:00:00.000Z' };
    const serverTime = '2026-11-02T04:00:00.000Z';
    mocks.api.tasks.registerMedia.mockImplementation(async (_task: string, body: { id: string }) => ({ ...ticket(body.id), uploadUrl: null }));
    mocks.api.taskMedia.confirmUploaded.mockResolvedValue({ mediaId: a.id, status: 'uploaded', uploadedAt: serverTime });
    expect(await uploadInstructionMedia('t1', [ahead, behind], serverTime, () => {})).toBe(0);
    const sent = mocks.api.tasks.registerMedia.mock.calls.map((c) => (c[1] as { capturedAt: string }).capturedAt);
    expect(sent).toEqual([serverTime, '2026-11-02T03:00:00.000Z']);
  });
});
