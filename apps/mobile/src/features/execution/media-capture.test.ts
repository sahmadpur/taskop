import { CaptureError, fileExtension, photoResize, videoMimeFor, videoProblem } from './media-capture';

describe('media capture rules', () => {
  it.each([
    [4000, 3000, { width: 1600 }],
    [3000, 4000, { height: 1600 }],
    [1600, 1200, null],
    [1200, 900, null],
  ])('resizes a %ix%i photo to %j', (w, h, expected) => {
    expect(photoResize(w, h)).toEqual(expected);
  });

  it('picks the video MIME type from the picker, else from the file name', () => {
    expect(videoMimeFor('file:///x/clip.MOV')).toBe('video/quicktime');
    expect(videoMimeFor('file:///x/clip.mp4')).toBe('video/mp4');
    expect(videoMimeFor('file:///x/clip', 'video/quicktime')).toBe('video/quicktime');
    expect(videoMimeFor('file:///x/clip.mov', 'video/x-unknown')).toBe('video/quicktime');
  });

  it.each([
    [{ durationMs: 60_000, bytes: 62_914_560, width: 1280, height: 720 }, null],
    [{ durationMs: 60_001, bytes: 1000, width: null, height: null }, 'tooLong'],
    [{ durationMs: null, bytes: 62_914_561, width: null, height: null }, 'tooLarge'],
    [{ durationMs: 10_000, bytes: 1000, width: 1920, height: 1080 }, 'resolution'],
  ])('checks a video %j', (video, expected) => {
    expect(videoProblem(video)).toBe(expected);
  });

  it('maps MIME types to storage extensions', () => {
    expect(fileExtension('image/jpeg')).toBe('jpg');
    expect(fileExtension('video/quicktime')).toBe('mov');
    expect(new CaptureError('tooLong').problem).toBe('tooLong');
  });
});
