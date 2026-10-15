import { extractText } from 'unpdf';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditReportJob } from '../src/audits/report/audit-report.job';
import { JobsService } from '../src/scheduling/jobs.service';
import { createTestApp, type TestApp } from './app';
import { auditLogOf, auditWorld, markUploaded, startAudit, verdictAll } from './audit-fixtures';
import { FakeClock } from './fake-clock';
import { MemoryStorage } from './memory-storage';
import { ownerQuery } from './owner-db';
import { noisePng } from './png';
import { MONDAY_0800 } from './scheduling-fixtures';

const FILE = 'taskop-audit-icra-yoxlamasi-2026-11-02.pdf';

interface AuditDbRow {
  report_status: string;
  report_storage_key: string | null;
  report_recipients: string[];
  report_sent_at: Date | null;
  report_attempts: number;
}

describe('the audit report job (spec §7.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  const storage = new MemoryStorage();
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock, storage });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    storage.failPut = false;
    t.mailer.failFor.clear();
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A finished audit (failed: the temperature rejected) whose photo is in storage; recipients from the checklist plus `extra`. */
  async function finished(opts: { checklistEmails?: string[]; extra?: string[] } = {}) {
    const a = await auditWorld(t, clock);
    await ownerQuery('update checklists set audit_report_emails = $2 where id = $1', [a.w.checklistId, opts.checklistEmails ?? ['qa@acme.az']]);
    await markUploaded(a.executionId);
    const key = (await ownerQuery<{ storage_key: string }>('select storage_key from execution_media where id = $1', [a.photoId])).rows[0]!.storage_key;
    storage.objects.set(key, { body: noisePng(16, 16, 7), contentType: 'image/jpeg' });
    clock.set('2026-11-02T05:00:00Z');
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id], [a.w.c.temp.id]);
    clock.set('2026-11-02T06:00:00Z');
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, { result: 'failed', comment: 'Temperatur yüksəkdir', extraEmails: opts.extra ?? [] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { a, auditId, job: { tenantId: a.w.s.tenantId, auditId } };
  }
  const row = async (auditId: string) => (await ownerQuery<AuditDbRow>('select * from audits where id = $1', [auditId])).rows[0]!;
  const run = (job: { tenantId: string; auditId: string; emails?: string[] }) => t.app.get(AuditReportJob).run(job);

  it('builds, stores and mails the report, one message per recipient', async () => {
    const { a, auditId, job } = await finished({ extra: ['boss@acme.az'] });
    const pending = await a.auditor.api.get(`/api/v1/audits/${auditId}/report.pdf`);
    expect([pending.status, pending.body.error.code]).toEqual([409, 'REPORT_NOT_READY']);
    clock.set('2026-11-02T06:01:00Z');
    expect(await run(job)).toBe('sent');
    const r = await row(auditId);
    expect(r).toMatchObject({ report_status: 'ready', report_storage_key: `tenants/${a.w.s.tenantId}/audits/${auditId}/report.pdf`, report_attempts: 0 });
    expect(r.report_sent_at?.toISOString()).toBe('2026-11-02T06:01:00.000Z');
    const stored = storage.objects.get(r.report_storage_key!)!;
    expect(stored.contentType).toBe('application/pdf');
    const mails = t.mailer.sent.filter((m) => m.attachments?.length && ['qa@acme.az', 'boss@acme.az'].includes(m.to));
    expect(mails.map((m) => [m.to, m.subject, m.attachments![0]!.filename])).toEqual([
      ['qa@acme.az', 'Audit hesabatı: İcra yoxlaması — Filial 1, 02.11.2026', FILE],
      ['boss@acme.az', 'Audit hesabatı: İcra yoxlaması — Filial 1, 02.11.2026', FILE],
    ]);
    const { text } = await extractText(new Uint8Array(stored.body), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of ['Audit hesabatı', 'İcra yoxlaması · Versiya 1', 'Filial 1', 'İşçi 1', 'Nəticə Uğursuz', 'Audit balı 75.0% (3/4)', 'Temperatur yüksəkdir', 'Problem: Adi — isti', 'Auditor']) {
      expect(flat, s).toContain(s);
    }
    expect((stored.body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(1);

    const pdf = await a.auditor.api.get(`/api/v1/audits/${auditId}/report.pdf`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="${FILE}"`);
    expect((await a.manager.api.get(`/api/v1/audits/${auditId}/report.pdf`)).status).toBe(200);
    expect((await a.outsider.api.get(`/api/v1/audits/${auditId}/report.pdf`)).status).toBe(404);
    expect((await a.worker.api.get(`/api/v1/audits/${auditId}/report.pdf`)).status).toBe(403);
    expect((await a.auditor.api.get(`/api/v1/audits/${auditId}`)).body).toMatchObject({ reportStatus: 'ready', reportSentAt: '2026-11-02T06:01:00.000Z' });
  });

  it('sends to the remaining recipients when one fails', async () => {
    const { auditId, job } = await finished({ checklistEmails: ['qa@acme.az', 'bad@acme.az'], extra: ['boss@acme.az'] });
    t.mailer.failFor.add('bad@acme.az');
    expect(await run(job)).toBe('sent');
    expect(t.mailer.sent.filter((m) => m.attachments?.length).map((m) => m.to)).toEqual(expect.arrayContaining(['qa@acme.az', 'boss@acme.az']));
    expect(t.mailer.sent.map((m) => m.to)).not.toContain('bad@acme.az');
    expect(await row(auditId)).toMatchObject({ report_status: 'ready', report_attempts: 0 });
    expect((await row(auditId)).report_sent_at).not.toBeNull();
  });

  it('retries when every send fails, reusing the stored PDF, and gives up on the fifth failure', async () => {
    const { a, auditId, job } = await finished();
    t.mailer.failFor.add('qa@acme.az');
    for (let attempt = 1; attempt <= 4; attempt++) {
      await expect(run(job), `attempt ${attempt}`).rejects.toThrow(/Every audit report e-mail/);
      expect((await row(auditId)).report_attempts).toBe(attempt);
    }
    expect(storage.objects.size).toBeGreaterThan(0);
    expect(await run(job)).toBe('failed');
    expect(await row(auditId)).toMatchObject({ report_status: 'failed', report_sent_at: null, report_attempts: 5 });
    expect((await a.auditor.api.get(`/api/v1/audits/${auditId}/report.pdf`)).body.error.code).toBe('REPORT_NOT_READY');
  });

  it('rebuilds a failed report through POST /report/send and sends it to the given addresses', async () => {
    const { a, auditId, job } = await finished();
    t.mailer.failFor.add('qa@acme.az');
    for (let attempt = 1; attempt <= 4; attempt++) await expect(run(job)).rejects.toThrow();
    expect(await run(job)).toBe('failed');
    t.mailer.failFor.clear();
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, { emails: ['New@acme.az'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ reportStatus: 'pending', reportRecipients: ['qa@acme.az'] });
    expect(await row(auditId)).toMatchObject({ report_status: 'pending', report_attempts: 0 });
    expect(send).toHaveBeenCalledWith('audit.report', { tenantId: a.w.s.tenantId, auditId, emails: ['new@acme.az'] });
    expect((await auditLogOf(auditId)).at(-1)).toMatchObject({ action: 'audit.report_sent', after: { recipients: ['new@acme.az'], rebuilt: true } });
    expect(await run({ ...job, emails: ['new@acme.az'] })).toBe('sent');
    expect(t.mailer.lastTo('new@acme.az')?.attachments?.[0]?.filename).toBe(FILE);
    expect((await row(auditId)).report_status).toBe('ready');
    expect((await a.manager.api.post(`/api/v1/audits/${auditId}/report/send`, {})).status).toBe(403);
  });

  it('retries when storing the PDF fails, and builds without mailing when nobody is listed', async () => {
    const { auditId, job } = await finished({ checklistEmails: [] });
    storage.failPut = true;
    await expect(run(job)).rejects.toThrow(/storage unavailable/);
    expect(await row(auditId)).toMatchObject({ report_status: 'pending', report_attempts: 1 });
    storage.failPut = false;
    expect(await run(job)).toBe('stored');
    expect(await row(auditId)).toMatchObject({ report_status: 'ready', report_sent_at: null });
  });

  it('refuses to send the report of an audit that has not finished, and skips a missing audit', async () => {
    const a = await auditWorld(t, clock);
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, {})).body.error.code).toBe('REPORT_NOT_READY');
    expect(await run({ tenantId: a.w.s.tenantId, auditId: uuidv7() })).toBe('missing');
  });

  it('embeds the readable photos and counts the ones that cannot be loaded or decoded as not embedded', async () => {
    for (const broken of ['corrupt', 'unreadable'] as const) {
      const { a, auditId, job } = await finished();
      const key = (await ownerQuery<{ storage_key: string }>('select storage_key from execution_media where id = $1', [a.photoId])).rows[0]!.storage_key;
      if (broken === 'corrupt') storage.objects.set(key, { body: Buffer.from('this is not an image'), contentType: 'image/jpeg' });
      else vi.spyOn(storage, 'getObject').mockImplementation(async (k: string) => {
        if (k === key) throw new Error('storage unavailable');
        return storage.objects.get(k)?.body ?? null;
      });
      expect(await run(job), broken).toBe('sent');
      const stored = storage.objects.get((await row(auditId)).report_storage_key!)!;
      expect((stored.body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length, broken).toBe(0);
      const { text } = await extractText(new Uint8Array(stored.body), { mergePages: true });
      expect(text.replace(/\s+/g, ' '), broken).toContain('+1 foto');
      expect(await row(auditId)).toMatchObject({ report_status: 'ready', report_attempts: 0 });
      vi.restoreAllMocks();
    }
  });

  it('refuses to resend to more than 20 addresses', async () => {
    const { a, auditId } = await finished();
    const emails = Array.from({ length: 21 }, (_, i) => `u${i}@acme.az`);
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, { emails });
    expect([res.status, res.body.error.code, res.body.error.fields]).toEqual([400, 'VALIDATION_FAILED', { emails: 'audits.issues.tooManyEmails' }]);
    expect((await row(auditId)).report_status).toBe('pending');
    const ok = await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, { emails: emails.slice(0, 20) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('queues the stored recipients when POST /report/send names no address, and keeps a ready report', async () => {
    const { a, auditId, job } = await finished();
    expect(await run(job)).toBe('sent');
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ reportStatus: 'ready', reportRecipients: ['qa@acme.az'] });
    expect(send).toHaveBeenCalledWith('audit.report', { tenantId: a.w.s.tenantId, auditId });
    expect((await auditLogOf(auditId)).at(-1)).toMatchObject({ action: 'audit.report_sent', after: { recipients: ['qa@acme.az'], rebuilt: false } });
    const before = t.mailer.sent.length;
    expect(await run(job)).toBe('sent');
    expect(t.mailer.sent.length).toBe(before + 1);
  });
});
