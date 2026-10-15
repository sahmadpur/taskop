import { describe, expect, it } from 'vitest';
import { auditReportMail } from './templates';

describe('auditReportMail', () => {
  it('names the checklist, site, day, result and auditor, with the PDF attached', () => {
    const pdf = Buffer.from('%PDF-1.7');
    const m = auditReportMail({ to: 'qa@acme.az', checklistName: 'Açılış', siteName: 'Filial 1', localDate: '2026-11-02', result: 'failed', auditorName: 'Auditor', pdf, filename: 'x.pdf' });
    expect(m.subject).toBe('Audit hesabatı: Açılış — Filial 1, 02.11.2026');
    expect(m.text).toContain('Nəticə: Uğursuz.');
    expect(m.text).toContain('Auditor: Auditor.');
    expect(m.attachments).toEqual([{ filename: 'x.pdf', content: pdf, contentType: 'application/pdf' }]);
  });

  it('keeps the subject on one line when a name contains line breaks or runs of spaces', () => {
    const m = auditReportMail({ to: 'qa@acme.az', checklistName: 'Açılış\r\nBcc: x@evil.az', siteName: ' Filial\n 1 ', localDate: '2026-11-02', result: 'passed', auditorName: 'Auditor', pdf: Buffer.from('%PDF'), filename: 'x.pdf' });
    expect(m.subject).toBe('Audit hesabatı: Açılış Bcc: x@evil.az — Filial 1, 02.11.2026');
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});
