import { readdirSync } from 'node:fs';
import { extractText } from 'unpdf';
import { describe, expect, it } from 'vitest';
import type { ReportDocument } from '../export/report-table';
import { FONTS_DIR, toPdf } from './pdf-document';

const doc: ReportDocument = {
  title: 'Xülasə hesabatı',
  tenantName: 'Acme MMC',
  from: '2026-11-02',
  to: '2026-11-04',
  filters: ['Obyekt: Zona A1'],
  generatedAt: new Date('2026-11-04T08:00:00Z'),
  timezone: 'Asia/Baku',
  sections: [
    { title: 'Xülasə', columns: [{ label: 'Göstərici', type: 'text' }, { label: 'Dəyər', type: 'number' }], rows: [['Tamamlanma faizi', 53.8], ['Planlaşdırılıb', 15], ['Orta bal', null]] },
    { title: 'Tapşırıqlar', columns: [{ label: 'Başlıq', type: 'text' }], rows: [] },
  ],
};

describe('PDF writer', () => {
  it('ships Noto Sans regular and bold with their licence', () => {
    expect(readdirSync(FONTS_DIR).sort()).toEqual(['NotoSans-Bold.ttf', 'NotoSans-Regular.ttf', 'OFL.txt']);
  });

  it('prints the header, every section and Azerbaijani letters', async () => {
    const out = await toPdf(doc);
    expect(out.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { text } = await extractText(new Uint8Array(out), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of [
      'Acme MMC', 'Xülasə hesabatı', 'Dövr: 02.11.2026 – 04.11.2026', 'Filtrlər: Obyekt: Zona A1', 'Hazırlanma vaxtı: 04.11.2026 12:00',
      'Tamamlanma faizi 53.8', 'Planlaşdırılıb 15', 'Orta bal —', 'Tapşırıqlar', 'Məlumat yoxdur.', 'Səhifə 1 / 1',
    ]) {
      expect(flat, s).toContain(s);
    }
  });

  it('says "yoxdur" without filters', async () => {
    const { text } = await extractText(new Uint8Array(await toPdf({ ...doc, filters: [] })), { mergePages: true });
    expect(text.replace(/\s+/g, ' ')).toContain('Filtrlər: yoxdur');
  });
});
