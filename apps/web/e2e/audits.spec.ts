import { readFile } from 'node:fs/promises';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { auditReportFileName, type ChecklistContent, type Item, type MediaUploadTicket, type SyncResponse } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { uuidv7 } from 'uuidv7';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const BIN = 'Zibil qutuları boşaldılıb?';
const BAD_SMELL = 'Pis qoxu var?';

/** The tenant's local date (new tenants are in Asia/Baku, which has no DST). */
const bakuDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

type Call = <T = unknown>(method: string, url: string, data?: unknown) => Promise<T>;

function apiAs(request: APIRequestContext, accessToken: string): Call {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async <T = unknown>(method: string, url: string, data?: unknown): Promise<T> => {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

interface Tenant {
  suffix: string;
  orgCode: string;
  email: string;
  password: string;
  owner: Call;
  workerSecret: string;
  checklistId: string;
  checklistName: string;
  yesterday: string;
}

/** A tenant with a site, a worker and a published checklist from a Taskop template, assigned once for yesterday. */
async function setupTenant(request: APIRequestContext, checklistName: string): Promise<Tenant> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-aud-${suffix}`;
  const email = `aud-${suffix}@example.az`;
  const password = 'e2e owner password';
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Audit MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const owner = apiAs(request, ((await signup.json()) as { accessToken: string }).accessToken);
  const types = await owner<Array<{ id: string; name: string }>>('GET', '/site-types');
  const site = await owner<{ id: string }>('POST', '/sites', { parentId: null, typeId: types.find((x) => x.name === 'Filial')!.id, name: 'Anbar №1' });
  const roles = await owner<Array<{ id: string; systemKey: string | null }>>('GET', '/roles');
  const worker = await owner<{ user: { id: string }; generatedSecret: string }>('POST', '/users/workers', {
    fullName: 'Nigar Səfərli',
    username: 'nigar',
    roleId: roles.find((r) => r.systemKey === 'worker')!.id,
    siteIds: [site.id],
  });
  const templates = await owner<Array<{ id: string; name: string; source: string }>>('GET', '/templates');
  const template = templates.find((x) => x.source === 'global' && x.name === 'Gündəlik təmizlik yoxlaması')!;
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: checklistName, from: { kind: 'global', templateId: template.id } });
  const draft = await owner<{ revision: number }>('GET', `/checklists/${checklist.id}/draft`);
  await owner('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });
  // Open from yesterday 00:00 to tomorrow 00:00 in Baku, so the test never races midnight.
  const yesterday = bakuDate(new Date(Date.now() - 86_400_000));
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 2880, graceMinutes: 0 },
  });
  return { suffix, orgCode, email, password, owner, workerSecret: worker.generatedSecret, checklistId: checklist.id, checklistName, yesterday };
}

async function signIn(page: Page, t: Tenant): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(t.email);
  await page.getByLabel('Şifrə', { exact: true }).fill(t.password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await expect(page.getByRole('heading', { name: 'İdarə paneli' })).toBeVisible();
}

interface Run {
  occurrenceId: string;
  executionId: string;
  phone: Call;
  stamp: () => { deviceTime: string; clientOffsetMs: number };
  item: (label: string) => Item;
}

/**
 * The phone completes the run: one uploaded photo; every yes/no "Bəli" except the bin (a normal rule problem) and
 * "Pis qoxu var?" (where "Xeyr" is the good answer). Ten items are visible.
 */
async function completeRun(request: APIRequestContext, t: Tenant, jpeg: Buffer): Promise<Run> {
  const login = await request.post('/api/v1/auth/login/worker', { data: { orgCode: t.orgCode, username: 'nigar', secret: t.workerSecret, client: 'mobile' } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const phone = apiAs(request, ((await login.json()) as { accessToken: string }).accessToken);
  const sync = await phone<SyncResponse>('GET', '/me/sync');
  const clientOffsetMs = Math.round(Date.now() - Date.parse(sync.serverTime));
  const stamp = () => ({ deviceTime: new Date().toISOString(), clientOffsetMs });
  expect(sync.occurrences).toHaveLength(1);
  const occurrence = sync.occurrences[0]!;
  const content = sync.checklistVersions.find((v) => v.id === occurrence.checklistVersionId)!.content as ChecklistContent;
  const items = content.sections.flatMap((s) => s.items);
  const item = (label: string) => items.find((i) => i.label === label)!;

  const executionId = uuidv7();
  await phone('POST', '/executions', {
    id: executionId,
    occurrenceId: occurrence.id,
    startedAt: new Date().toISOString(),
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    ...stamp(),
  });
  const photoItem = item('Ümumi görünüşün fotosu');
  const photoId = uuidv7();
  const ticket = await phone<MediaUploadTicket>('POST', `/executions/${executionId}/media`, {
    id: photoId,
    itemId: photoItem.id,
    kind: 'photo',
    source: 'camera',
    mime: 'image/jpeg',
    bytes: jpeg.length,
    width: 64,
    height: 48,
    capturedAt: new Date().toISOString(),
    ...stamp(),
  });
  // The presigned PUT, as the phone sends it; Playwright sets Content-Length from the body itself.
  const put = await request.put(ticket.uploadUrl!, { headers: { 'Content-Type': 'image/jpeg' }, data: jpeg });
  expect(put.ok(), `upload: ${await put.text()}`).toBeTruthy();
  await phone('POST', `/media/${photoId}/uploaded`, {});

  const answers: Record<string, Record<string, unknown>> = {};
  for (const i of items) {
    if (i.type === 'yes_no') answers[i.id] = { optionIds: [[BIN, BAD_SMELL].includes(i.label) ? i.options[1].id : i.options[0].id] };
    if (i.type === 'single_choice') answers[i.id] = { optionIds: [i.options[0]!.id] };
  }
  answers[photoItem.id] = { photos: [photoId] };
  await phone('PUT', `/executions/${executionId}/answers`, { rev: 1, answers, ...stamp() });
  const completed = await phone('POST', `/executions/${executionId}/complete`, { rev: 2, answers, completedAt: new Date().toISOString(), ...stamp() });
  expect(completed).toMatchObject({ state: 'completed', score: { percent: 87.5 } });
  return { occurrenceId: occurrence.id, executionId, phone, stamp, item };
}

/** A small real JPEG of the page, for the photo item (decision 19). */
const jpegOf = (page: Page) => page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: 64, height: 48 } });

const progress = (page: Page, reviewed: number, total = 10) =>
  page.getByText(az.audits.progress.replace('{{reviewed}}', String(reviewed)).replace('{{total}}', String(total)), { exact: true });

/** The first item approved with A, the bin rejected with a comment, the other eight approved with A. */
async function reviewAll(page: Page) {
  const items = page.getByRole('navigation', { name: az.audits.web.screen.items });
  await expect(items.getByRole('button')).toHaveCount(10);
  await expect(progress(page, 0)).toBeVisible();
  await expect(items.getByRole('button', { name: 'Döşəmə təmiz və qurudur?' })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('a');
  await expect(progress(page, 1)).toBeVisible();
  const bin = items.getByRole('button', { name: BIN });
  await expect(bin).toHaveAttribute('aria-current', 'true');
  await page.getByLabel(az.audits.fields.comment).fill('Zibil qutuları dolu idi');
  await page.getByRole('button', { name: az.audits.actions.reject }).click();
  await expect(progress(page, 2)).toBeVisible();
  await expect(bin).toHaveAttribute('data-verdict', 'rejected');
  for (let n = 3; n <= 10; n++) {
    await page.keyboard.press('a');
    await expect(progress(page, n)).toBeVisible();
  }
  return { items, bin };
}

test('a checklist that requires audit: the run waits, the auditor fails it, the PDF downloads and is mailed', async ({ page, request }) => {
  test.setTimeout(180_000);
  const t = await setupTenant(request, 'E2E audit');
  const reportTo = `audit-${t.suffix}@example.az`;
  await signIn(page, t);

  // The checklist requires audit and mails its report to one address (decision 15).
  await page.goto(`/checklists/${t.checklistId}`);
  const settings = page.getByRole('region', { name: az.audits.web.settings.title });
  await settings.getByRole('switch', { name: az.audits.fields.requiresAudit }).click();
  await settings.getByLabel(az.audits.fields.reportEmails).fill(reportTo);
  await settings.getByLabel(az.audits.fields.reportEmails).press('Enter');
  await settings.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect
    .poll(async () => t.owner<{ requiresAudit: boolean; auditReportEmails: string[] }>('GET', `/checklists/${t.checklistId}`))
    .toMatchObject({ requiresAudit: true, auditReportEmails: [reportTo] });

  // The worker completes the run: it goes straight to audit_pending.
  const run = await completeRun(request, t, await jpegOf(page));
  expect(await t.owner('GET', `/occurrences/${run.occurrenceId}`)).toMatchObject({ status: 'audit_pending' });

  // The audit queue: Waiting has the run.
  await page.getByRole('link', { name: az.nav.audits }).click();
  await expect(page.getByRole('tab', { name: az.audits.queues.waiting })).toHaveAttribute('aria-selected', 'true');
  const row = page.getByRole('row').filter({ hasText: 'E2E audit' });
  for (const text of ['Anbar №1', 'Nigar Səfərli']) await expect(row).toContainText(text);
  await row.getByRole('button', { name: az.audits.actions.start }).click();
  await expect(page).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E audit' })).toBeVisible();

  // The photo is in the existing viewer.
  await page.getByRole('navigation', { name: az.audits.web.screen.items }).getByRole('button', { name: 'Ümumi görünüşün fotosu' }).click();
  await expect(page.getByRole('region', { name: 'Ümumi görünüşün fotosu' }).getByRole('button', { name: 'Bax: Foto' })).toBeVisible();
  await page.getByRole('navigation', { name: az.audits.web.screen.items }).getByRole('button', { name: 'Döşəmə təmiz və qurudur?' }).click();

  await reviewAll(page);

  // Finish: failed, with a comment; the checklist's address is listed.
  await page.getByRole('button', { name: az.audits.actions.finish }).click();
  const dialog = page.getByRole('dialog', { name: az.audits.web.finish.title });
  await expect(dialog.getByText(reportTo)).toBeVisible();
  await dialog.getByRole('radio', { name: az.audits.results.failed }).check();
  await dialog.getByLabel(az.audits.fields.comment).fill('Zibil qutuları vaxtında boşaldılmır.');
  await dialog.getByRole('button', { name: az.audits.web.finish.submit }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(az.audits.statuses.finished, { exact: true })).toBeVisible();
  await expect(page.getByText(az.audits.results.failed, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: az.audits.actions.approve })).toHaveCount(0);

  // The PDF: built by the job, then downloaded under the server's name.
  const report = page.getByRole('region', { name: az.audits.web.report.title });
  const download = report.getByRole('button', { name: az.audits.actions.downloadReport });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const downloading = page.waitForEvent('download');
  await download.click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe(auditReportFileName('E2E audit', t.yesterday));
  expect((await readFile(await file.path())).subarray(0, 4).toString('latin1')).toBe('%PDF');

  // The e-mail, with the PDF attached (spec §7.2).
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${reportTo}"`)}`);
        if (!res.ok()) return null;
        const body = (await res.json()) as { messages: Array<{ Subject: string; Attachments: number }> };
        return body.messages.map((m) => ({ subject: m.Subject.startsWith('Audit hesabatı: E2E audit'), attachments: m.Attachments }));
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toEqual([{ subject: true, attachments: 1 }]);
});

test('a run sent back during its audit: the worker fixes the flagged item, its verdict is reset, the auditor finishes', async ({ page, request }) => {
  test.setTimeout(180_000);
  const t = await setupTenant(request, 'E2E düzəliş');
  await signIn(page, t);
  const run = await completeRun(request, t, await jpegOf(page));
  const bin = run.item(BIN);
  if (bin.type !== 'yes_no') throw new Error('the bin item is a yes/no question');

  // An on-demand audit from the run dialog's Audit tab.
  await page.goto(`/schedule?date=${t.yesterday}&occurrence=${run.occurrenceId}&tab=audit`);
  await page.getByRole('dialog', { name: 'E2E düzəliş' }).getByRole('button', { name: az.audits.actions.start }).click();
  await expect(page).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);
  const auditUrl = page.url();
  const { items } = await reviewAll(page);

  // The manager sends the bin back from the run.
  await page.getByRole('link', { name: az.audits.web.screen.openRun }).click();
  const runDialog = page.getByRole('dialog', { name: 'E2E düzəliş' });
  await expect(runDialog.getByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
  await runDialog.getByRole('button', { name: az.corrections.actions.sendBack }).click();
  const sendBack = page.getByRole('dialog', { name: az.corrections.web.sendBack.title });
  await sendBack.getByRole('checkbox', { name: BIN }).click();
  await sendBack.getByRole('textbox', { name: az.corrections.web.sendBack.comment.replace('{{item}}', BIN) }).fill('Qutuları boşaldın və yenidən göndərin');
  await sendBack.getByRole('button', { name: az.corrections.actions.sendBack }).click();
  await expect(sendBack).toBeHidden();
  await expect(runDialog.getByText(az.corrections.web.rework.flagged)).toBeVisible();

  // The audit is paused while the worker fixes it.
  await page.goto(auditUrl);
  await expect(page.getByText(az.audits.paused)).toBeVisible();
  await expect(page.getByRole('button', { name: az.audits.actions.finish })).toBeDisabled();

  // The worker's phone: only the bin is flagged; it is fixed and resubmitted.
  const sync = await run.phone<SyncResponse>('GET', '/me/sync');
  const reworked = sync.executions.find((x) => x.id === run.executionId)!;
  expect(reworked).toMatchObject({
    state: 'rework',
    reworkRound: 1,
    rework: { round: 1, requestedBy: { fullName: 'Leyla Quliyeva' }, items: [{ itemId: bin.id, comment: 'Qutuları boşaldın və yenidən göndərin' }] },
  });
  // The guard's starting point: the answers at send-back, the bin still "Xeyr".
  expect(reworked.rework!.answersBefore[bin.id]).toEqual({ optionIds: [bin.options[1].id] });
  const fixed = { ...reworked.answers, [bin.id]: { optionIds: [bin.options[0].id] } };
  await run.phone('PUT', `/executions/${run.executionId}/answers`, { rev: reworked.answersRev + 1, answers: fixed, ...run.stamp() });
  expect(await run.phone('POST', `/executions/${run.executionId}/resubmit`, { round: reworked.reworkRound, resubmittedAt: new Date().toISOString(), ...run.stamp() })).toMatchObject({
    state: 'completed',
    status: 'audit_pending',
  });

  // The audit resumes: the changed item's verdict was reset, and its original answer is one click away.
  await page.reload();
  await expect(page.getByText(az.audits.paused)).toHaveCount(0);
  await expect(progress(page, 9)).toBeVisible();
  const binButton = items.getByRole('button', { name: BIN });
  await expect(binButton).toHaveAttribute('data-verdict', 'none');
  await binButton.click();
  const panel = page.getByRole('region', { name: BIN });
  await expect(panel).toContainText('Bəli');
  await panel.getByRole('button', { name: az.corrections.original }).click();
  await expect(panel).toContainText('Xeyr');
  await page.keyboard.press('a');
  await expect(progress(page, 10)).toBeVisible();

  await page.getByRole('button', { name: az.audits.actions.finish }).click();
  const dialog = page.getByRole('dialog', { name: az.audits.web.finish.title });
  await dialog.getByRole('radio', { name: az.audits.results.passed }).check();
  await dialog.getByRole('button', { name: az.audits.web.finish.submit }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(az.audits.statuses.finished, { exact: true })).toBeVisible();
  await expect(page.getByText(az.audits.results.passed, { exact: true })).toBeVisible();

  // The run's Corrections tab: the original and current answer, and the round.
  await page.goto(`/schedule?date=${t.yesterday}&occurrence=${run.occurrenceId}&tab=corrections`);
  const corrections = page.getByRole('dialog', { name: 'E2E düzəliş' });
  const diffRow = corrections.getByRole('row').filter({ hasText: BIN });
  await expect(diffRow).toContainText('Xeyr');
  await expect(diffRow).toContainText('Bəli');
  await expect(corrections.getByText('Leyla Quliyeva icranı düzəlişə qaytardı', { exact: false })).toBeVisible();
  await expect(corrections.getByText(az.corrections.web.timeline.resubmitted, { exact: false })).toBeVisible();
});
