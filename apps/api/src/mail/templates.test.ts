import { describe, expect, it } from 'vitest';
import { auditReportMail, inviteMail, passwordResetMail, verifyEmailMail } from './templates';

describe('auditReportMail', () => {
  it('names the checklist, site, day, result and auditor, with the PDF attached', () => {
    const pdf = Buffer.from('%PDF-1.7');
    const m = auditReportMail({ to: 'qa@acme.az', checklistName: 'Açılış', siteName: 'Filial 1', localDate: '2026-11-02', result: 'failed', auditorName: 'Auditor', pdf, filename: 'x.pdf', locale: 'az' });
    expect(m.subject).toBe('Audit hesabatı: Açılış — Filial 1, 02.11.2026');
    expect(m.text).toContain('Nəticə: Uğursuz.');
    expect(m.text).toContain('Auditor: Auditor.');
    expect(m.attachments).toEqual([{ filename: 'x.pdf', content: pdf, contentType: 'application/pdf' }]);
  });

  it('keeps the subject on one line when a name contains line breaks or runs of spaces', () => {
    const m = auditReportMail({ to: 'qa@acme.az', checklistName: 'Açılış\r\nBcc: x@evil.az', siteName: ' Filial\n 1 ', localDate: '2026-11-02', result: 'passed', auditorName: 'Auditor', pdf: Buffer.from('%PDF'), filename: 'x.pdf', locale: 'az' });
    expect(m.subject).toBe('Audit hesabatı: Açılış Bcc: x@evil.az — Filial 1, 02.11.2026');
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe('languages', () => {
  const base = { to: 'a@acme.az', fullName: 'Ayşə', webUrl: 'https://app.taskop.app', token: 't0k/en' };

  it('writes the account e-mails in English and Russian with the same link', () => {
    const en = verifyEmailMail({ ...base, locale: 'en' });
    expect(en.subject).toBe('Taskop — confirm your e-mail address');
    expect(en.text).toContain('Hello, Ayşə!');
    expect(en.text).toContain('https://app.taskop.app/verify-email?token=t0k%2Fen');
    const ru = passwordResetMail({ ...base, locale: 'ru' });
    expect(ru.subject).toBe('Taskop — восстановление пароля');
    expect(ru.text).toContain('https://app.taskop.app/reset-password?token=t0k%2Fen');
    const invite = inviteMail({ ...base, orgName: 'Acme', locale: 'en' });
    expect(invite.subject).toBe('Taskop — invitation to Acme');
    expect(invite.text).toContain('"Acme"');
    expect(inviteMail({ ...base, orgName: 'Acme', locale: 'az' }).subject).toBe('Taskop — Acme təşkilatına dəvət');
  });

  it('writes the audit report e-mail in English and Russian', () => {
    const p = { to: 'qa@acme.az', checklistName: 'Açılış', siteName: 'Filial 1', localDate: '2026-11-02', result: 'failed' as const, auditorName: 'Auditor', pdf: Buffer.from('%PDF'), filename: 'x.pdf' };
    const en = auditReportMail({ ...p, locale: 'en' });
    expect(en.subject).toBe('Audit report: Açılış — Filial 1, 02.11.2026');
    expect(en.text).toContain('Result: Failed.');
    const ru = auditReportMail({ ...p, locale: 'ru' });
    expect(ru.subject).toBe('Отчёт аудита: Açılış — Filial 1, 02.11.2026');
    expect(ru.text).toContain('Результат: Не пройден.');
  });
});
