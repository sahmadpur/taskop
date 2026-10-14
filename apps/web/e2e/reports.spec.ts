import { readFile } from 'node:fs/promises';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { addDays, type ChecklistContent, type ReportSummary, type SyncResponse } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';

/** The tenant's local date (new tenants are in Asia/Baku, which has no DST). */
const bakuDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

function apiAs(request: APIRequestContext, accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async function call<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

test('the dashboard shows the seeded runs; Overdue opens the runs report on its bucket; Excel downloads it', async ({ page, request }) => {
  // The overdue run waits for the status sweep (every minute): allow for two sweeps (decision 18).
  test.setTimeout(180_000);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-rep-${suffix}`;
  const email = `rep-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, site, worker and a published checklist from a Taskop template.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Hesabat MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
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
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: 'E2E hesabat', from: { kind: 'global', templateId: template.id } });
  const draft = await owner<{ revision: number }>('GET', `/checklists/${checklist.id}/draft`);
  await owner('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });

  // Run 1, yesterday: open from yesterday 00:00 to tomorrow 00:00 in Baku; the worker completes it.
  const yesterday = bakuDate(new Date(Date.now() - 86_400_000));
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 2880, graceMinutes: 0 },
  });

  const login = await request.post('/api/v1/auth/login/worker', { data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'mobile' } });
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
  await phone('POST', `/executions/${executionId}/media`, {
    id: photoId,
    itemId: photoItem.id,
    kind: 'photo',
    source: 'camera',
    mime: 'image/jpeg',
    bytes: 1000,
    width: 1600,
    height: 1200,
    capturedAt: new Date().toISOString(),
    ...stamp(),
  });
  const answers: Record<string, Record<string, unknown>> = {};
  for (const i of items) {
    // "Zibil qutuları boşaldılıb?" = Xeyr is a rule problem (normal). "Pis qoxu var?" = Xeyr is the good answer.
    if (i.type === 'yes_no') {
      answers[i.id] = { optionIds: [['Zibil qutuları boşaldılıb?', 'Pis qoxu var?'].includes(i.label) ? i.options[1].id : i.options[0].id] };
    }
    if (i.type === 'single_choice') answers[i.id] = { optionIds: [i.options[0]!.id] };
  }
  answers[photoItem.id] = { photos: [photoId] };
  const glass = item('Giriş qapısının şüşələri təmizdir?');
  answers[glass.id] = { ...answers[glass.id], problem: { severity: 'critical', note: 'Şüşədə çat var', mediaIds: [] } };
  await phone('PUT', `/executions/${executionId}/answers`, { rev: 1, answers, ...stamp() });
  const completed = await phone('POST', `/executions/${executionId}/complete`, { rev: 2, answers, completedAt: new Date().toISOString(), ...stamp() });
  expect(completed).toMatchObject({ state: 'completed', score: { percent: 87.5 } });

  // Run 2, yesterday: due one minute after midnight and open two more days, never started: the sweep makes it overdue.
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 1, graceMinutes: 2880 },
  });
  await expect
    .poll(async () => (await owner<ReportSummary>('GET', `/reports/summary?from=${yesterday}&to=${yesterday}`)).counts, { timeout: 90_000, intervals: [2_000] })
    .toMatchObject({ planned: 2, due: 2, completed: 1, inProgress: 0, overdue: 1, withProblems: 1, withCritical: 1 });

  // The owner on the web: the home page is the dashboard (decision 17).
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await expect(page.getByRole('heading', { name: 'İdarə paneli' })).toBeVisible();

  // Last 7 days covers yesterday whatever the time of day (decision 18).
  await page.getByLabel('Dövr').selectOption('last_7');
  await expect(page).toHaveURL(/[?&]period=last_7/);
  for (const name of ['Planlaşdırılıb: 2', 'Tamamlanıb: 1', 'Davam edir: 0', 'Gecikib: 1', 'Problemli: 1']) {
    await expect(page.getByRole('link', { name })).toBeVisible();
  }
  await expect(page.getByRole('group', { name: 'Tamamlanma faizi' })).toContainText('50%');
  await expect(page.getByRole('group', { name: 'Orta bal' })).toContainText(/87[,.]5%/);
  await expect(page.getByRole('figure', { name: 'Gündəlik icra' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Kritik problemlər' })).toContainText('Şüşədə çat var');

  // Overdue → the runs report, overdue bucket, same period.
  await page.getByRole('link', { name: 'Gecikib: 1' }).click();
  await expect(page).toHaveURL(/\/reports\?/);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ period: 'last_7', tab: 'runs', bucket: 'overdue' });
  await expect(page.getByRole('tab', { name: 'İcralar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('group', { name: 'İcralar' }).getByRole('button', { name: 'Gecikmiş' })).toHaveAttribute('aria-pressed', 'true');
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  for (const text of ['E2E hesabat', 'Anbar №1', 'Gecikib', 'Nigar Səfərli']) await expect(rows.nth(1)).toContainText(text);

  // Export this table as Excel: the server names the file (spec §5.4).
  const today = bakuDate(new Date());
  await page.getByRole('button', { name: 'İxrac et' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('group', { name: 'Bu cədvəl' }).getByRole('menuitem', { name: 'Excel' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`taskop-runs-${addDays(today, -6)}_${today}.xlsx`);
  // An .xlsx file is a ZIP archive.
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  await expect(page.getByRole('button', { name: 'İxrac et' })).toBeEnabled();
});
