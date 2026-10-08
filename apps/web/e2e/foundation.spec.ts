import { expect, test } from '@playwright/test';

test('owner signs up, creates a site and a worker, and finds the worker after logging back in', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const orgCode = `e2e-${suffix}`;
  const email = `owner-${suffix}@example.az`;
  const password = 'e2e owner password';

  await page.goto('/signup');
  await page.getByLabel('Təşkilatın adı').fill('E2E MMC');
  await page.getByLabel('Təşkilat kodu').fill(orgCode);
  await page.getByLabel('Ad və soyad').fill('Elvin Əhmədov');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Qeydiyyatdan keç' }).click();
  await expect(page.getByRole('heading', { name: 'Xoş gəlmisiniz, Elvin!' })).toBeVisible();

  await page.getByRole('link', { name: 'Obyektlər' }).click();
  await page.getByRole('button', { name: 'Əsas obyekt əlavə et' }).click();
  await page.getByLabel('Ad', { exact: true }).fill('Anbar №1');
  await page.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect(page.getByRole('treeitem').getByText('Anbar №1')).toBeVisible();

  await page.getByRole('link', { name: 'İstifadəçilər' }).click();
  await page.getByRole('button', { name: 'Yeni işçi' }).click();
  await page.getByLabel('Ad və soyad').fill('Nigar Səfərli');
  await page.getByLabel('İstifadəçi adı').fill('nigar');
  await page.getByRole('checkbox', { name: 'Anbar №1' }).check();
  await page.getByRole('button', { name: 'Yarat' }).click();
  await expect(page.getByText('Giriş məlumatları')).toBeVisible();
  await expect(page.getByText(orgCode)).toBeVisible();
  await page.getByRole('button', { name: 'Hazırdır' }).click();

  await page.getByRole('button', { name: 'Çıxış' }).click();
  await expect(page.getByRole('heading', { name: 'Taskop-a daxil olun' })).toBeVisible();
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await page.getByRole('link', { name: 'İstifadəçilər' }).click();
  await expect(page.getByRole('cell', { name: /Nigar Səfərli/ })).toBeVisible();
});
