import { extractText } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { noisePng } from '../../../test/png';
import { type AuditReportData, buildAuditReport, type ReportItem, selectReportPhotos } from './audit-report-builder';

const dataUrl = (seed: number) => `data:image/png;base64,${noisePng(8, 8, seed).toString('base64')}`;
const item = (over: Partial<ReportItem>): ReportItem => ({
  itemId: 'i', label: 'Sual', depth: 0, answer: 'Bəli', original: null, correctedBy: null, verdict: 'approved', verdictComment: null,
  problem: null, photos: [], morePhotos: 0, videos: 0, ...over,
});

const reportData = (over: Partial<AuditReportData> = {}): AuditReportData => ({
  auditId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f',
  tenantName: 'Acme MMC',
  timezone: 'Asia/Baku',
  checklistName: 'Açılış yoxlaması',
  versionNumber: 3,
  siteName: 'Filial 1',
  executorName: 'İşçi 1',
  localDate: '2026-11-02',
  window: { startsAt: new Date('2026-11-02T04:00:00Z'), closesAt: new Date('2026-11-02T07:00:00Z') },
  startedAt: new Date('2026-11-02T04:10:00Z'),
  completedAt: new Date('2026-11-02T04:20:00Z'),
  syncedAt: new Date('2026-11-02T05:00:00Z'),
  auditorName: 'Auditor',
  finishedAt: new Date('2026-11-02T06:00:00Z'),
  result: 'failed',
  auditScore: { approved: 3, rejected: 1, reviewed: 4, percent: 75 },
  runScore: 100,
  originalScore: 50,
  comment: 'Temperatur rejimi pozulub',
  sections: [
    {
      title: 'Zal',
      items: [
        item({ itemId: 'a', label: 'Problem varmı?', answer: 'Xeyr' }),
        item({
          itemId: 'b', label: 'Temperatur', answer: '5 — yenidən ölçüldü', original: '10 — isti', correctedBy: { name: 'Menecer', reason: 'Termometr səhv oxunub' },
          verdict: 'rejected', verdictComment: 'Hələ də yüksəkdir', problem: { severity: 'normal', note: 'isti' },
        }),
        item({ itemId: 'c', label: 'Ümumi görünüş', answer: '5 foto', photos: [dataUrl(1), dataUrl(2), dataUrl(3)], morePhotos: 2, videos: 1, verdict: null }),
      ],
    },
  ],
  generatedAt: new Date('2026-11-02T06:01:00Z'),
  locale: 'az',
  ...over,
});

const imageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;

describe('audit report builder (spec §7.2)', () => {
  it('prints the header, the items with verdicts, corrections and problems, and the footer', async () => {
    const pdf = await buildAuditReport(reportData());
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of [
      'Acme MMC', 'Audit hesabatı', 'Açılış yoxlaması · Versiya 3', 'Filial 1', 'İşçi 1', '02.11.2026 08:00 – 02.11.2026 11:00',
      'Başlanıb (cihaz) 02.11.2026 08:10', 'Tamamlanıb (cihaz) 02.11.2026 08:20', 'Serverə çatıb 02.11.2026 09:00', 'Audit bitib 02.11.2026 10:00',
      'Nəticə Uğursuz', 'Audit balı 75.0% (3/4)', 'İcra balı 100.0% (İlkin bal: 50.0%)', 'Temperatur rejimi pozulub',
      'Zal', 'Problem varmı?', 'Xeyr', 'Təsdiqlənib', 'Temperatur', 'İlkin cavab: 10 — isti', 'Düzəliş: Menecer — Termometr səhv oxunub',
      'Problem: Adi — isti', 'Rədd edilib', 'Hələ də yüksəkdir', 'Yoxlanılmayıb', '+2 foto · 1 video',
      'Audit ID: 0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', 'Səhifə 1 / 1',
    ]) {
      expect(flat, s).toContain(s);
    }
    expect(imageCount(pdf)).toBe(3);
  });

  it('prints only the current score when the run was never corrected', async () => {
    const { text } = await extractText(new Uint8Array(await buildAuditReport(reportData({ runScore: 50, originalScore: null, comment: null }))), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toContain('İcra balı 50.0%');
    expect(flat).not.toContain('İlkin bal');
    expect(flat).toContain('Yekun şərh —');
  });

  it('keeps very long answers, originals and comments by letting rows break across pages', async () => {
    const words = (n: number, last: string) => `${Array.from({ length: n }, () => 'Söz').join(' ')} ${last}`;
    const long = item({ itemId: 'l', label: 'Uzun cavab', answer: words(1200, 'sonuncuCavab'), original: words(1200, 'sonuncuİlkin'), verdict: 'rejected', verdictComment: words(1200, 'sonuncuŞərh') });
    expect(long.answer.length).toBeGreaterThan(4500);
    const pdf = await buildAuditReport(reportData({ sections: [{ title: 'Zal', items: [long, item({ itemId: 'after', label: 'Sonrakı sual' })] }] }));
    const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of ['sonuncuCavab', 'sonuncuİlkin', 'sonuncuŞərh', 'Sonrakı sual']) expect(flat, s).toContain(s);
  });

  it('embeds no more than the photo limits even when the caller passes more', async () => {
    const many = Array.from({ length: 5 }, (_, i) => dataUrl(i + 1));
    const items = Array.from({ length: 15 }, (_, i) => item({ itemId: `m${i}`, label: `Foto ${i}`, photos: many }));
    expect(imageCount(await buildAuditReport(reportData({ sections: [{ title: 'Zal', items }] })))).toBe(40);
  });

  it('embeds at most 3 photos per item and 40 per report, in checklist order, counting the rest', () => {
    const items = Array.from({ length: 20 }, (_, i) => `i${i}`);
    const photos = new Map(items.map((id) => [id, ['p1', 'p2', 'p3', 'p4']]));
    const { embedded, skipped } = selectReportPhotos(items, photos);
    expect([...embedded.values()].flat()).toHaveLength(40);
    expect(embedded.get('i0')).toEqual(['p1', 'p2', 'p3']);
    expect(embedded.get('i13')).toEqual(['p1']);
    expect(embedded.has('i14')).toBe(false);
    expect([skipped.get('i0'), skipped.get('i13'), skipped.get('i19')]).toEqual([1, 3, 4]);
    expect(selectReportPhotos(['x'], new Map()).embedded.size).toBe(0);
  });
});

describe('audit report languages', () => {
  const flatText = async (pdf: Buffer) => (await extractText(new Uint8Array(pdf), { mergePages: true })).text.replace(/\s+/g, ' ');

  it('prints the labels in English', async () => {
    const flat = await flatText(await buildAuditReport(reportData({ locale: 'en' })));
    for (const s of ['Audit report', 'Açılış yoxlaması · Version 3', 'Result Failed', 'Audit score 75.0% (3/4)', 'Run score 100.0% (Original score: 50.0%)', 'Approved', 'Rejected', 'Not reviewed', 'Page 1 / 1']) {
      expect(flat, s).toContain(s);
    }
    expect(flat).not.toContain('Audit hesabatı');
  });

  it('prints the labels in Russian', async () => {
    const flat = await flatText(await buildAuditReport(reportData({ locale: 'ru' })));
    for (const s of ['Отчёт аудита', 'Результат Не пройден', 'Страница 1 / 1']) expect(flat, s).toContain(s);
  });
});
