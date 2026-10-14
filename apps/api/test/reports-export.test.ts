import { parse } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import { extractText } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addSite, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('report exports (spec §5.4)', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({ REPORTS_STATEMENT_TIMEOUT_MS: '60000' }, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const file = async (api: Api, kind: string, q: Record<string, string | undefined>) => {
    const res = await api.get(`/api/v1/reports/${kind}/export?${qs(q)}`).responseType('blob');
    expect(res.status, String(res.body)).toBe(200);
    return { body: res.body as Buffer, type: res.headers['content-type'] as string, disposition: res.headers['content-disposition'] as string };
  };
  const csvRows = (b: Buffer) => parse(b.toString('utf8'), { bom: true }) as string[][];
  const pdfText = async (b: Buffer) => (await extractText(new Uint8Array(b), { mergePages: true })).text.replace(/\s+/g, ' ');

  it('exports runs as CSV with a BOM, Azerbaijani labels and both completion times', async () => {
    const f = await file(w.owner, 'runs', { ...PERIOD, format: 'csv' });
    expect(f.type).toBe('text/csv; charset=utf-8');
    expect(f.disposition).toBe('attachment; filename="taskop-runs-2026-11-02_2026-11-04.csv"');
    expect([...f.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = csvRows(f.body);
    expect(rows[0]).toEqual([
      'Tarix', 'Son vaxt', 'Yoxlama vərəqəsi', 'Obyekt', 'Status', 'İcraçılar', 'İcra edən', 'Başlanıb', 'Tamamlanıb (cihaz)', 'Serverə çatıb', 'Bal', 'Problemlər', 'Kritik', 'Gecikmə ilə', 'Saat şübhəli',
    ]);
    expect(rows).toHaveLength(17);
    // r7: done on the phone at 11:00 Baku on Monday, received by the server on Wednesday at 09:00 (FR-10.14).
    expect(rows.find((r) => r[9] === '04.11.2026 09:00')).toEqual([
      '02.11.2026', '02.11.2026 10:00', 'Açılış yoxlaması', 'Zona A1', 'Tamamlanıb', 'Aynur Quliyeva', 'Aynur Quliyeva', '02.11.2026 08:10', '02.11.2026 11:00', '04.11.2026 09:00', '90.0', '0', '0', 'Bəli', 'Xeyr',
    ]);
  });

  it('keeps problem notes intact and neutralises formulas in CSV', async () => {
    const rows = csvRows((await file(w.owner, 'problems', { ...PERIOD, format: 'csv' })).body);
    expect(rows.map((r) => r[6])).toEqual(['Qeyd', '', "'=1+2", 'Kondisioner, "xarab"\nyenisi lazımdır', 'Qapı sınıqdır']);
  });

  it('exports the full report as one Excel sheet per section with typed cells', async () => {
    const f = await file(w.owner, 'full', { ...PERIOD, format: 'xlsx' });
    expect(f.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(f.disposition).toBe('attachment; filename="taskop-full-2026-11-02_2026-11-04.xlsx"');
    const sheets = await readXlsxFile(f.body);
    expect(sheets.map((s) => [s.sheet, s.data.length])).toEqual([
      ['Xülasə', 13], ['Gündəlik', 4], ['Obyektlər', 5], ['Əməkdaşlar', 6],
      ['Gecikmiş icralar', 2], ['Yarımçıq icralar', 2], ['Buraxılmış icralar', 4], ['Problemlər', 5], ['Tapşırıqlar', 10],
    ]);
    const sites = sheets[2]!.data;
    expect(sites[2]!.slice(0, 4)).toEqual(['Zona A1', 'Filial A', 'Bəli', 7]);
    expect(sites[2]![sites[0]!.indexOf('Tamamlanma faizi')]).toBe(57.1);
    expect(sheets[1]!.data[1]).toEqual([new Date('2026-11-02T00:00:00.000Z'), 6, 4, 66.7]);
    // r10 (the first missed run) was due at 10:00 Baku: a Date cell on the tenant's wall clock.
    const due = sheets[6]!.data[1]![1] as unknown as Date;
    expect(due).toBeInstanceOf(Date);
    expect(Math.abs(+due - +new Date('2026-11-03T10:00:00.000Z'))).toBeLessThan(1000);
  });

  it('exports a PDF with the tenant, the period, the filters and Azerbaijani labels', async () => {
    const f = await file(w.owner, 'summary', { ...PERIOD, siteId: w.sites.zoneA1, format: 'pdf' });
    expect(f.type).toBe('application/pdf');
    expect(f.disposition).toBe('attachment; filename="taskop-summary-2026-11-02_2026-11-04.pdf"');
    expect(f.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = await pdfText(f.body);
    for (const s of ['Acme MMC', 'Xülasə hesabatı', 'Dövr: 02.11.2026 – 04.11.2026', 'Filtrlər: Obyekt: Zona A1', 'Hazırlanma vaxtı: 04.11.2026 12:00', 'Tamamlanma faizi 57.1', 'Gündəlik']) {
      expect(text, s).toContain(s);
    }
  });

  it('exports within the caller’s scope and filters, and audits each export', async () => {
    const rows = csvRows((await file(w.leyla.api, 'runs', { ...PERIOD, format: 'csv', bucket: 'missed', siteId: w.sites.branchA })).body);
    expect(rows.slice(1).map((r) => r[3])).toEqual(['Zona A1', 'Zona A1']);
    const audit = await ownerQuery<{ entity_type: string; entity_id: string | null; after: unknown }>(
      "select entity_type, entity_id, after from audit_log where tenant_id = $1 and action = 'reports.exported' and actor_user_id = $2",
      [w.s.tenantId, w.leyla.id],
    );
    expect(audit.rows).toEqual([
      {
        entity_type: 'report',
        entity_id: null,
        after: { kind: 'runs', format: 'csv', filters: { from: '2026-11-02', to: '2026-11-04', siteId: w.sites.branchA, userId: null, checklistId: null, bucket: 'missed', severity: null }, rows: 2 },
      },
    ]);
  });

  it('names filter entities in the PDF header only inside the viewer’s scope', async () => {
    const scoped = await pdfText((await file(w.leyla.api, 'summary', { ...PERIOD, format: 'pdf', userId: w.nigar.id, siteId: w.sites.branchB })).body);
    expect(scoped).toContain('Obyekt: —');
    expect(scoped).toContain('Əməkdaş: —');
    expect(scoped).not.toContain('Nigar');
    expect(scoped).not.toContain('Filial B');
    // Inside her scope the names still print.
    const inside = await pdfText((await file(w.leyla.api, 'summary', { ...PERIOD, format: 'pdf', userId: w.aynur.id, siteId: w.sites.zoneA1 })).body);
    expect(inside).toContain('Obyekt: Zona A1');
    expect(inside).toContain('Əməkdaş: Aynur Quliyeva');
    // A subordinates viewer sees the sites of their people's runs, not other branches.
    const role = await w.owner.post('/api/v1/roles', { name: 'Nəzarətçi ixrac', dataScope: 'subordinates', permissions: ['reports.view', 'reports.export'] });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const user = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: role.body.id as string, fullName: 'Rauf İxrac', managerId: w.leyla.id, emailVerified: true });
    const api = as(t, (await loginStaff(t, user.email!, user.secret, 'web')).accessToken);
    const outside = await pdfText((await file(api, 'summary', { ...PERIOD, format: 'pdf', siteId: w.sites.branchB })).body);
    expect(outside).toContain('Obyekt: —');
    expect(outside).not.toContain('Filial B');
  });

  it('produces header-only files for an empty period', async () => {
    const empty = { from: '2026-12-01', to: '2026-12-01' };
    expect(csvRows((await file(w.owner, 'runs', { ...empty, format: 'csv' })).body)).toHaveLength(1);
    expect((await readXlsxFile((await file(w.owner, 'tasks', { ...empty, format: 'xlsx' })).body)).map((s) => s.data.length)).toEqual([1]);
    expect(await pdfText((await file(w.owner, 'problems', { ...empty, format: 'pdf' })).body)).toContain('Məlumat yoxdur.');
  });

  it('refuses CSV for the full report, unknown kinds and callers without reports.export', async () => {
    const csv = await w.owner.get(`/api/v1/reports/full/export?${qs({ ...PERIOD, format: 'csv' })}`);
    expect([csv.status, csv.body.error.code, csv.body.error.fields]).toEqual([400, 'VALIDATION_FAILED', { format: 'reports.issues.fullNotCsv' }]);
    expect((await w.owner.get(`/api/v1/reports/attendance/export?${qs({ ...PERIOD, format: 'csv' })}`)).status).toBe(404);
    expect((await w.owner.get(`/api/v1/reports/runs/export?${qs(PERIOD)}`)).status).toBe(400);
    // Rauf has reports.view but not reports.export.
    expect((await w.rauf.api.get(`/api/v1/reports/runs/export?${qs({ ...PERIOD, format: 'csv' })}`)).status).toBe(403);
    const viewOnly = await w.owner.post('/api/v1/roles', { name: 'Hesabat baxışı', dataScope: 'all', permissions: ['reports.view'] });
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: viewOnly.body.id as string, emailVerified: true });
    const api = as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    expect((await api.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(200);
    expect((await api.get(`/api/v1/reports/summary/export?${qs({ ...PERIOD, format: 'pdf' })}`)).status).toBe(403);
  });

  it('refuses more than 10,000 rows with 422 before building the file, and audits nothing', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Böyük filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    await ownerQuery(
      `with a as (
         insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, status, created_by_user_id)
         select gen_random_uuid(), $1, $2, $3, '{}'::jsonb, '{}'::jsonb, 'ended', $4 from generate_series(1, 10001)
         returning id)
       insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status, checklist_version_id)
       select gen_random_uuid(), $1, a.id, $2, $3, '2026-11-03', '2026-11-03T04:00:00Z', '2026-11-03T06:00:00Z', '2026-11-03T07:00:00Z', 'missed', $5 from a`,
      [b.s.tenantId, checklist.id, site, b.s.ownerId, checklist.versionId],
    );
    const runs = await b.owner.get(`/api/v1/reports/runs/export?${qs({ ...PERIOD, format: 'xlsx' })}`);
    expect([runs.status, runs.body.error.code, runs.body.error.rows, runs.body.error.limit]).toEqual([422, 'REPORT_TOO_LARGE', 10001, 10000]);
    const full = await b.owner.get(`/api/v1/reports/full/export?${qs({ ...PERIOD, format: 'pdf' })}`);
    expect([full.status, full.body.error.rows]).toEqual([422, 10001]);
    // The site table has one row: fine.
    expect((await file(b.owner, 'sites', { ...PERIOD, format: 'csv' })).body.length).toBeGreaterThan(0);
    expect((await ownerQuery("select after->>'kind' as kind from audit_log where tenant_id = $1 and action = 'reports.exported'", [b.s.tenantId])).rows).toEqual([{ kind: 'sites' }]);
  }, 60_000);
});
