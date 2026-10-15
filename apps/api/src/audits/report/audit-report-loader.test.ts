import { describe, expect, it } from 'vitest';
import { imageDataUrl, mapLimit } from './audit-report-loader';
import { noisePng } from '../../../test/png';

describe('imageDataUrl', () => {
  it('accepts PNG and JPEG by their magic bytes, whatever the stored mime says', () => {
    expect(imageDataUrl(noisePng(4, 4))).toMatch(/^data:image\/png;base64,/);
    // SOI, then a SOF0 header of a 1 × 1 three-component image: all pdfkit needs to open it.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    expect(imageDataUrl(jpeg)).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('rejects anything pdfmake cannot decode', () => {
    for (const body of [Buffer.alloc(0), Buffer.from('not an image'), Buffer.from('GIF89a....'), Buffer.from([0x89, 0x50, 0x4e]), Buffer.from([0xff, 0xd8]),
      // The signatures alone, or followed by garbage, are not images.
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage garbage')]), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]),
      // A valid PNG cut short.
      noisePng(16, 16).subarray(0, 100)]) {
      expect(imageDataUrl(body)).toBeNull();
    }
  });
});

describe('mapLimit', () => {
  it('never runs more than the limit at once and keeps the order of the items', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit(Array.from({ length: 40 }, (_, i) => i), 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, (n % 3) * 2));
      running--;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(out).toEqual(Array.from({ length: 40 }, (_, i) => i * 2));
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
