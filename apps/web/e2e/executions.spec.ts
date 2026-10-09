import { randomBytes } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { ChecklistContent, SyncResponse } from '@taskop/contracts';

/** UUIDv7 (RFC 9562): 48-bit Unix ms, version 7, variant 10, random rest. The phone generates IDs like this. */
function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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

test('a worker executes an occurrence through the API, then the owner reads it in the drawer and the problems list', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-exe-${suffix}`;
  const email = `exe-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, site, worker and a published checklist from a Taskop template.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E İcra MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
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
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: 'E2E icra', from: { kind: 'global', templateId: template.id } });
  const draft = await owner<{ revision: number }>('GET', `/checklists/${checklist.id}/draft`);
  await owner('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });

  // An occurrence open right now: yesterday 00:00 to tomorrow 00:00 in Baku, so the test never races midnight.
  const yesterday = bakuDate(new Date(Date.now() - 86_400_000));
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 2880, graceMinutes: 0 },
  });

  // The phone (stood in for by the API): sync, claim, register a photo it never uploads, answer, complete.
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
  const claim = await phone('POST', '/executions', {
    id: executionId,
    occurrenceId: occurrence.id,
    startedAt: new Date().toISOString(),
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    ...stamp(),
  });
  expect(claim).toMatchObject({ state: 'active', reason: null });

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
  // A manual critical problem on a good answer.
  const glass = item('Giriş qapısının şüşələri təmizdir?');
  answers[glass.id] = { ...answers[glass.id], problem: { severity: 'critical', note: 'Şüşədə çat var', mediaIds: [] } };
  await phone('PUT', `/executions/${executionId}/answers`, { rev: 1, answers, ...stamp() });
  const completed = await phone('POST', `/executions/${executionId}/complete`, { rev: 2, answers, completedAt: new Date().toISOString(), ...stamp() });
  // 10 visible items, the optional comment unanswered; 8 scored items, one problem: 87.5 %.
  expect(completed).toMatchObject({ state: 'completed', late: false, progress: { answered: 9, total: 10, requiredMissing: 0 }, score: { percent: 87.5 } });

  // The owner on the web.
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();

  // The problems list: both problems, then the severity filter.
  await page.getByRole('link', { name: 'Problemlər' }).click();
  await expect(page.getByRole('heading', { name: 'Problemlər' })).toBeVisible();
  const glassRow = page.getByRole('row').filter({ hasText: 'Şüşədə çat var' });
  const binRow = page.getByRole('row').filter({ hasText: 'Zibil qutuları boşaldılıb?' });
  for (const text of ['Giriş qapısının şüşələri təmizdir?', 'Kritik', 'Əl ilə qeyd', 'Nigar Səfərli', 'Anbar №1', 'E2E icra']) {
    await expect(glassRow).toContainText(text);
  }
  await expect(binRow).toContainText('Adi');
  await expect(binRow).toContainText('Qayda üzrə');
  await page.getByLabel('Ciddilik').selectOption('critical');
  await expect(binRow).toHaveCount(0);
  await expect(glassRow).toBeVisible();

  // A row opens the occurrence drawer on its execution tab.
  await glassRow.getByRole('link', { name: 'Giriş qapısının şüşələri təmizdir?' }).click();
  await expect(page).toHaveURL(/\/schedule\?/);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByText('Nigar Səfərli', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Tamamlanıb', { exact: true })).toBeVisible();
  await expect(drawer.getByText('1 fayl hələ yüklənməyib')).toBeVisible();
  await expect(drawer.getByText('9/10 cavab')).toBeVisible();
  await expect(drawer.getByText(/^87[,.]5%$/)).toBeVisible();
  const glassAnswer = drawer.getByRole('listitem', { name: 'Giriş qapısının şüşələri təmizdir?' });
  await expect(glassAnswer).toContainText('Bəli');
  await expect(glassAnswer).toContainText('Kritik');
  await expect(glassAnswer).toContainText('Şüşədə çat var');
  await expect(drawer.getByRole('listitem', { name: 'Zibil qutuları boşaldılıb?' })).toContainText('Xeyr');
  await expect(drawer.getByRole('listitem', { name: 'Ümumi görünüşün fotosu' }).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeVisible();

  // The schedule row shows the counted execution.
  await drawer.getByRole('button', { name: 'Bağla', exact: true }).click();
  const row = page.getByRole('button', { name: /E2E icra/ });
  for (const text of ['Tamamlanıb', 'Nigar Səfərli', '9/10']) await expect(row).toContainText(text);
});
