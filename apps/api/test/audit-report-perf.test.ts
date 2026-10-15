import { describe, expect, it } from 'vitest';
import { type AuditReportData, buildAuditReport, type ReportSection } from '../src/audits/report/audit-report-builder';
import { noisePng } from './png';

const MB = 1024 * 1024;

/** Spec §7.2: 200 items and 40 photos of about 1.5 MB build in under 10 s, and the peak RSS grows by less than 512 MB
 * (maxRSS before and after the build: heap deltas depend on when V8 collects, and a sampler cannot fire during synchronous work). */
describe('audit report performance', () => {
  it('builds 200 items with 40 photos of 1.5 MB in under 10 s and 512 MB of peak RSS', async () => {
    const photos = Array.from({ length: 40 }, (_, i) => noisePng(708, 708, i + 1));
    expect(photos[0]!.length).toBeGreaterThan(1.4 * MB);
    const sections: ReportSection[] = Array.from({ length: 10 }, (_, s) => ({
      title: `Bölmə ${s + 1}`,
      items: Array.from({ length: 20 }, (_, i) => {
        const n = s * 20 + i;
        // The first 14 items carry 3, 3, …, 1 photos: 40 in all, as selectReportPhotos would pass them.
        const own = n < 13 ? [n * 3, n * 3 + 1, n * 3 + 2] : n === 13 ? [39] : [];
        return {
          itemId: `item-${n}`,
          label: `Sual ${n + 1}: soyuducunun temperaturu normadadırmı?`,
          depth: n % 3 === 2 ? 1 : 0,
          answer: n % 2 ? 'Bəli' : '5 °C — qeyd yoxdur',
          original: n % 10 === 0 ? '10 °C' : null,
          correctedBy: n % 10 === 0 ? { name: 'Menecer', reason: 'Termometr səhv oxunub' } : null,
          verdict: n % 7 === 0 ? 'rejected' : 'approved',
          verdictComment: n % 7 === 0 ? 'Uyğun deyil' : null,
          problem: n % 9 === 0 ? { severity: 'normal', note: 'Temperatur yüksəkdir' } : null,
          photos: own.map((p) => `data:image/png;base64,${photos[p]!.toString('base64')}`),
          morePhotos: 0,
          videos: n % 25 === 0 ? 1 : 0,
        };
      }),
    }));
    const data: AuditReportData = {
      auditId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', tenantName: 'Acme MMC', timezone: 'Asia/Baku', checklistName: 'Böyük yoxlama', versionNumber: 1,
      siteName: 'Filial 1', executorName: 'İşçi 1', localDate: '2026-11-02',
      window: { startsAt: new Date('2026-11-02T04:00:00Z'), closesAt: new Date('2026-11-02T07:00:00Z') },
      startedAt: new Date('2026-11-02T04:10:00Z'), completedAt: new Date('2026-11-02T05:00:00Z'), syncedAt: new Date('2026-11-02T05:00:00Z'),
      auditorName: 'Auditor', finishedAt: new Date('2026-11-02T06:00:00Z'), result: 'passed',
      auditScore: { approved: 171, rejected: 29, reviewed: 200, percent: 85.5 }, runScore: 90, originalScore: 80, comment: null,
      sections, generatedAt: new Date('2026-11-02T06:01:00Z'),
    };
    // maxRSS is a high-water mark, so it does not depend on when V8 collects (spec §7.2, R9b). Collect first when --expose-gc is on.
    (globalThis as { gc?: () => void }).gc?.();
    const before = process.memoryUsage();
    const maxBefore = process.resourceUsage().maxRSS; // KB
    const started = performance.now();
    const pdf = await buildAuditReport(data);
    const ms = performance.now() - started;
    const after = process.memoryUsage();
    const peakGrowth = (process.resourceUsage().maxRSS - maxBefore) / 1024; // MB
    const mb = (n: number): number => Math.round(n / MB);
    console.info(
      `audit report: ${Math.round(ms)} ms, maxRSS +${Math.round(peakGrowth)} MB, heapUsed +${mb(after.heapUsed - before.heapUsed)}, external +${mb(after.external - before.external)}, arrayBuffers +${mb(after.arrayBuffers - before.arrayBuffers)}, rss ${mb(after.rss)} MB, ${mb(pdf.length)} MB PDF`,
    );
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(40);
    expect(ms).toBeLessThan(10_000);
    expect(peakGrowth).toBeLessThan(512);
  }, 60_000);
});
