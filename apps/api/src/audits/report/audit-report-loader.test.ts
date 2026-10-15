import { describe, expect, it } from 'vitest';
import { imageDataUrl, mapLimit } from './audit-report-loader';
import { noisePng } from '../../../test/png';

describe('imageDataUrl', () => {
  it('accepts PNG and JPEG by their magic bytes, whatever the stored mime says', () => {
    expect(imageDataUrl(noisePng(4, 4))).toMatch(/^data:image\/png;base64,/);
    expect(imageDataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('rejects anything pdfmake cannot decode', () => {
    for (const body of [Buffer.alloc(0), Buffer.from('not an image'), Buffer.from('GIF89a....'), Buffer.from([0x89, 0x50, 0x4e]), Buffer.from([0xff, 0xd8])]) {
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
