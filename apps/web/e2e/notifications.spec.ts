import { type APIRequestContext, expect, test } from '@playwright/test';
import type { NotificationItem, NotificationRuleDto } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { uuidv7 } from 'uuidv7';

function apiAs(request: APIRequestContext, accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async function call<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

test('an admin changes the task.assigned rule and messages a team; the member sees both in the bell and marks them read', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-notif-${suffix}`;
  const email = `notif-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, a team and a worker in it.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Bildiriş MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const owner = apiAs(request, ((await signup.json()) as { accessToken: string }).accessToken);
  const roles = await owner<Array<{ id: string; systemKey: string | null }>>('GET', '/roles');
  const team = await owner<{ id: string }>('POST', '/teams', { name: 'Texniki xidmət' });
  const worker = await owner<{ user: { id: string }; generatedSecret: string }>('POST', '/users/workers', {
    fullName: 'Nigar Səfərli',
    username: 'nigar',
    roleId: roles.find((r) => r.systemKey === 'worker')!.id,
    teamIds: [team.id],
  });

  // The owner on the web: e-mail on for "task assigned".
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await page.getByRole('link', { name: 'Parametrlər' }).click();
  await page.getByRole('tab', { name: 'Bildirişlər' }).click();
  const control = (name: string) => `${az.notifications.types['task.assigned']} — ${name}`;
  const emailBox = page.getByRole('checkbox', { name: control(az.notifications.channels.email), exact: true });
  await expect(emailBox).not.toBeChecked();
  await emailBox.check();
  await page.getByRole('button', { name: control('Yadda saxla'), exact: true }).click();
  await expect(page.getByRole('row').filter({ has: emailBox }).getByText('Dəyişdirilib')).toBeVisible();
  // The rule change is checked on the server: the tenant now has its own task.assigned rule with e-mail on.
  // It does not change what the member sees below: she is a worker without an e-mail address, so the e-mail
  // channel creates no delivery for her task.assigned notification and no SMTP send happens (CI needs no mailbox).
  // The default rule already notifies the team's members, so her bell looks the same with or without this change.
  const rules = await owner<NotificationRuleDto[]>('GET', '/notification-rules');
  expect(rules.find((r) => r.type === 'task.assigned')).toMatchObject({ enabled: true, push: true, email: true, notifyAssignees: true, isDefault: false });

  // A task for the team (the member is told while nobody has accepted it).
  const taskId = uuidv7();
  await owner('POST', '/tasks', { id: taskId, title: 'Soyuducunun qapısını təmir edin', assignee: { teamId: team.id } });

  // A message to the team: picker, preview, confirm.
  await page.getByRole('link', { name: 'Mesajlar' }).click();
  await page.getByRole('combobox', { name: 'Alıcılar' }).fill('Texniki');
  await page.getByRole('option', { name: 'Texniki xidmət' }).click();
  await expect(page.getByRole('list', { name: 'Seçilmiş alıcılar' })).toContainText('Texniki xidmət');
  await page.getByLabel('Başlıq', { exact: true }).fill('Sabah iclas var');
  await page.getByLabel('Mətn', { exact: true }).fill('Saat 10:00-da anbarda qısa iclas olacaq.');
  await page.getByRole('button', { name: 'Göndər', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Mesajı göndər' });
  await expect(confirm).toContainText('1 nəfərə göndəriləcək');
  await confirm.getByRole('button', { name: 'Göndər', exact: true }).click();
  await expect(confirm).toBeHidden();
  const historyRow = page.getByRole('row').filter({ hasText: 'Sabah iclas var' });
  await expect(historyRow).toContainText('Leyla Quliyeva');

  // Fan-out runs in jobs after the commits: wait for both notifications (≤ 15 s, no sleeps).
  const memberLogin = await request.post('/api/v1/auth/login/worker', {
    data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'mobile' },
  });
  expect(memberLogin.ok(), await memberLogin.text()).toBeTruthy();
  const member = apiAs(request, ((await memberLogin.json()) as { accessToken: string }).accessToken);
  await expect
    .poll(async () => (await member<{ count: number }>('GET', '/me/notifications/unread-count')).count, { timeout: 15_000 })
    .toBe(2);
  const inbox = await member<{ items: NotificationItem[] }>('GET', '/me/notifications');
  const taskNote = inbox.items.find((n) => n.type === 'task.assigned')!;
  const messageNote = inbox.items.find((n) => n.type === 'manual')!;
  expect(taskNote).toMatchObject({ targetKind: 'task', targetId: taskId, readAt: null });
  expect(messageNote).toMatchObject({ targetKind: 'none', targetId: null, readAt: null });

  // The owner sees who got the message: the history polls while it fans out, then delivered in-app, unread, no phone.
  await expect(historyRow.getByRole('cell').nth(3)).toHaveText('1', { timeout: 10_000 });
  await expect(historyRow.getByRole('cell').nth(4)).toHaveText('0');
  await historyRow.getByRole('link', { name: 'Sabah iclas var' }).click();
  const detail = page.getByRole('dialog', { name: 'Sabah iclas var' });
  await expect(detail).toContainText('Alıcılar: 1 · Oxunub: 0');
  const recipient = detail.getByRole('row').filter({ hasText: 'Nigar Səfərli' });
  await expect(recipient).toContainText('Oxunmayıb');
  await expect(recipient).toContainText('Cihaz yoxdur');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Çıxış' }).click();
  await expect(page.getByRole('heading', { name: 'Taskop-a daxil olun' })).toBeVisible();

  // The member on the web (decision 16): a worker session with the web client's refresh cookie.
  const web = await page.request.post('/api/v1/auth/login/worker', {
    data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'web' },
  });
  expect(web.ok(), await web.text()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'Bildirişlər: 2 oxunmamış' }).click();
  const popover = page.getByRole('dialog', { name: 'Bildirişlər' });
  await expect(popover.getByRole('listitem')).toHaveCount(2);
  await expect(popover.getByRole('listitem').filter({ hasText: messageNote.title })).toContainText('Oxunmamış');

  // The task notification opens the task and is read.
  await popover.getByRole('listitem').filter({ hasText: taskNote.title }).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${taskId}$`));
  await expect(page.getByRole('dialog', { name: 'Soyuducunun qapısını təmir edin' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);

  // The message is marked read with the rest.
  await page.getByRole('button', { name: 'Bildirişlər: 1 oxunmamış' }).click();
  await popover.getByRole('button', { name: 'Hamısını oxunmuş et' }).click();
  await expect(page.getByRole('button', { name: 'Bildirişlər', exact: true })).toBeVisible();
  await popover.getByRole('link', { name: 'Hamısına bax' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  // The popover stays mounted while its close animation runs and holds a list of the same name.
  await expect(popover).toBeHidden();
  const list = page.getByRole('list', { name: 'Bildirişlər' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText(messageNote.title);
  await expect(list).not.toContainText('Oxunmamış');
  expect(await member('GET', '/me/notifications/unread-count')).toEqual({ count: 0 });
});
