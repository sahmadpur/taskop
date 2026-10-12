import { type APIRequestContext, expect, test } from '@playwright/test';
import type { ChecklistContent, SyncResponse, TaskDetail } from '@taskop/contracts';
// The phone's client ids (UUIDv7), from the package the web already uses (decision 13).
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

test('a closed run’s problem becomes a task on the web; the worker answers through the API; the manager sends it back, then approves; the problem is resolved', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-task-${suffix}`;
  const email = `task-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, site, worker and a published checklist from a Taskop template.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Tapşırıq MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
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
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: 'E2E tapşırıq', from: { kind: 'global', templateId: template.id } });
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

  // The phone (stood in for by the API) runs and closes the checklist with a manual critical problem.
  const login = await request.post('/api/v1/auth/login/worker', { data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'mobile' } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const phone = apiAs(request, ((await login.json()) as { accessToken: string }).accessToken);
  const sync = await phone<SyncResponse>('GET', '/me/sync');
  const clientOffsetMs = Math.round(Date.now() - Date.parse(sync.serverTime));
  const stamp = () => ({ deviceTime: new Date().toISOString(), clientOffsetMs });
  expect(sync.occurrences).toHaveLength(1);
  expect(sync.tasks).toEqual([]);
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
  expect(completed).toMatchObject({ state: 'completed' });

  // The owner on the web turns the glass problem into a task.
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await page.getByRole('link', { name: 'Problemlər' }).click();
  const glassRow = page.getByRole('row').filter({ hasText: 'Şüşədə çat var' });
  await glassRow.getByRole('button', { name: 'Tapşırıq yarat' }).click();

  const dialog = page.getByRole('dialog', { name: 'Problemdən tapşırıq' });
  await expect(dialog.getByLabel('Başlıq', { exact: true })).toHaveValue('Giriş qapısının şüşələri təmizdir?');
  await expect(dialog.getByLabel('Təlimat', { exact: true })).toHaveValue('Şüşədə çat var');
  await expect(dialog.getByLabel('Prioritet', { exact: true })).toHaveValue('high');
  await expect(dialog.getByRole('checkbox', { name: 'Tamamlandıqdan sonra yoxlama tələb olunur' })).toBeChecked();
  await expect(dialog.getByText('Obyekt problemdən götürülür: Anbar №1')).toBeVisible();
  // Wait for the filtered option and the search response before clicking (ruling W9).
  const assignees = page.waitForResponse((res) => res.url().includes('/tasks/assignees') && res.url().includes('q='));
  await dialog.getByRole('combobox', { name: 'İcraçı', exact: true }).fill('Nigar');
  await assignees;
  const option = dialog.getByRole('option', { name: 'Nigar Səfərli' });
  await expect(option).toBeVisible();
  await option.click();
  await dialog.getByRole('button', { name: 'Yarat', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(glassRow.getByRole('link', { name: 'Açıq' })).toBeVisible();

  // The phone: the task arrives with the next sync; start and answer (no evidence is required by default).
  const taskSync = await phone<SyncResponse>('GET', '/me/sync');
  expect(taskSync.tasks).toHaveLength(1);
  const task = taskSync.tasks[0]!;
  expect(task).toMatchObject({ status: 'new', title: 'Giriş qapısının şüşələri təmizdir?', priority: 'high', requiresReview: true, site: { name: 'Anbar №1' } });
  await phone('POST', `/tasks/${task.id}/start`, { at: new Date().toISOString() });
  const first = await phone<TaskDetail>('POST', `/tasks/${task.id}/submissions`, {
    id: uuidv7(),
    text: 'Şüşə dəyişdirildi',
    mediaIds: [],
    submittedAt: new Date().toISOString(),
  });
  expect(first.status).toBe('awaiting_review');

  // The manager sends it back from the drawer. The task created a moment ago is cached (staleTime 30 s) as "Yeni",
  // so reload to see the phone's answer, as a manager opening the page later would.
  await page.reload();
  await glassRow.getByRole('link', { name: 'Açıq' }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${task.id}`));
  const drawer = page.getByRole('dialog', { name: 'Giriş qapısının şüşələri təmizdir?' });
  await expect(drawer.getByText('Yoxlamada', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('listitem', { name: 'Cavab 1' })).toContainText('Şüşə dəyişdirildi');
  await expect(drawer.getByRole('region', { name: 'Mənbə problem' })).toContainText('Şüşədə çat var');
  await drawer.getByLabel('Geri qaytarma səbəbi').fill('Qırıq şüşənin qalıqlarını da yığın');
  await drawer.getByRole('button', { name: 'Geri qaytar' }).click();
  await expect(drawer.getByText('İcradadır', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('listitem', { name: 'Cavab 1' })).toContainText('Geri qaytarılıb');

  // The phone answers again.
  const second = await phone<TaskDetail>('POST', `/tasks/${task.id}/submissions`, {
    id: uuidv7(),
    text: 'Qalıqlar yığıldı',
    mediaIds: [],
    submittedAt: new Date().toISOString(),
  });
  expect(second.status).toBe('awaiting_review');

  // The drawer is a link: a reload opens it again with the new answer; the manager approves.
  await page.reload();
  await expect(drawer.getByRole('listitem', { name: 'Cavab 2' })).toContainText('Qalıqlar yığıldı');
  await drawer.getByRole('button', { name: 'Təsdiqlə' }).click();
  await expect(drawer.getByText('Tamamlanıb', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('listitem', { name: 'Cavab 2' })).toContainText('Təsdiqlənib');
  await expect(drawer.getByRole('region', { name: 'Tarixçə' })).toContainText('Yoxlamada → Tamamlanıb');

  // The task list, then the problem: resolved.
  await drawer.getByRole('button', { name: 'Bağla', exact: true }).click();
  const taskRow = page.getByRole('row').filter({ hasText: 'Giriş qapısının şüşələri təmizdir?' });
  for (const text of ['Tamamlanıb', 'Nigar Səfərli', 'Anbar №1', 'Problemdən']) await expect(taskRow).toContainText(text);
  await page.getByRole('link', { name: 'Problemlər' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Şüşədə çat var' }).getByRole('link', { name: 'Həll olunub' })).toBeVisible();
});
