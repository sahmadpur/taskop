import { expect, type Page, type Response, test } from '@playwright/test';

test('owner builds a checklist from a template, publishes v1 and v2, and v1 stays unchanged', async ({
  page,
}) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/signup');
  await page.getByLabel('Təşkilatın adı').fill('E2E Checklist MMC');
  await page.getByLabel('Təşkilat kodu').fill(`e2e-cl-${suffix}`);
  await page.getByLabel('Ad və soyad').fill('Elvin Əhmədov');
  await page.getByLabel('E-poçt', { exact: true }).fill(`cl-${suffix}@example.az`);
  await page.getByLabel('Şifrə', { exact: true }).fill('e2e owner password');
  await page.getByRole('button', { name: 'Qeydiyyatdan keç' }).click();
  await expect(page.getByRole('heading', { name: 'Xoş gəlmisiniz, Elvin!' })).toBeVisible();

  // Create from a Taskop template.
  await page.getByRole('link', { name: 'Şablonlar' }).click();
  const card = page.locator('[data-slot="card"]', { hasText: 'Gündəlik təmizlik yoxlaması' });
  await card.getByRole('button', { name: 'İstifadə et' }).click();
  await page.getByLabel('Ad', { exact: true }).fill('E2E təmizlik');
  await page.getByRole('button', { name: 'Yarat' }).click();
  await expect(page.getByRole('heading', { name: 'E2E təmizlik' })).toBeVisible();

  // Add a yes/no item with "Yes → critical problem + photo" and a follow-up.
  await page.getByRole('button', { name: '+ Bənd əlavə et' }).first().click();
  await page.getByRole('button', { name: 'Bəli / Xeyr' }).click();
  await page.getByRole('complementary').getByLabel('Sualın mətni').fill('Soyuducu qapısı açıq qalıb?');
  await page.getByRole('button', { name: 'Qayda əlavə et' }).click();
  await page.getByRole('complementary').getByRole('checkbox', { name: 'Bəli' }).click();
  await page.getByRole('complementary').getByLabel('Problem').selectOption('critical');
  await page.getByRole('complementary').getByRole('checkbox', { name: 'Foto tələb et' }).click();
  await page.getByRole('button', { name: '+ Əlavə sual' }).click();
  await page.getByRole('button', { name: 'Şərh', exact: true }).click();
  await page.getByRole('complementary').getByLabel('Sualın mətni').fill('Nə qədər müddət açıq qalıb?');

  // Reorder with "Move to…": move the new item to position 2 of its section.
  await page.getByRole('button', { name: 'Köçür… — Soyuducu qapısı açıq qalıb?' }).click();
  await page.getByLabel('Mövqe').selectOption('2');
  const v1DraftSaved = waitForDraftSave(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Köçür' }).click();
  // Top-level items of the first section (the template's first item has its own nested follow-up treeitem).
  const firstSectionItems = page
    .getByRole('tree')
    .locator(':scope > [role="treeitem"]')
    .first()
    .locator(':scope > [role="group"] > [role="treeitem"]');
  await expect(firstSectionItems.nth(1)).toHaveAccessibleName('Soyuducu qapısı açıq qalıb?');
  await expect(
    firstSectionItems.nth(1).getByRole('treeitem', { name: 'Nə qədər müddət açıq qalıb?' }),
  ).toBeVisible();

  // Publish v1 once the draft has actually been saved.
  await v1DraftSaved;
  await expect(page.getByText('Yadda saxlanıldı')).toBeVisible();
  await page.getByRole('button', { name: 'Dərc et' }).click();
  await page.getByLabel('Dəyişiklik qeydi (istəyə bağlı)').fill('İlk versiya');
  await page.getByRole('dialog').getByRole('button', { name: 'Dərc et' }).click();
  await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();

  // Edit → publish v2.
  await page.getByRole('button', { name: 'Redaktə et' }).click();
  const v2DraftSaved = waitForDraftSave(page);
  await page.getByLabel('Bölmənin adı').fill('Giriş və dəhliz (yenilənib)');
  await v2DraftSaved;
  await expect(page.getByText('Yadda saxlanıldı')).toBeVisible();
  await page.getByRole('button', { name: 'Dərc et' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dərc et' }).click();
  await expect(page.getByRole('cell', { name: 'v2' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();

  // Positive control: v2 has the new section title.
  await page.getByRole('row', { name: /v2/ }).getByRole('link', { name: 'Bax' }).click();
  await expect(page.getByLabel('Bölmənin adı')).toHaveValue('Giriş və dəhliz (yenilənib)');
  await expect(page.getByText('Yalnız baxış')).toBeVisible();
  await page.goBack();

  // v1 still has the original section title, the moved item, its follow-up and its rule.
  await page.getByRole('row', { name: /v1/ }).getByRole('link', { name: 'Bax' }).click();
  await expect(page.getByLabel('Bölmənin adı')).toHaveValue('Giriş və dəhliz');
  await expect(page.getByText('Yalnız baxış')).toBeVisible();
  await expect(firstSectionItems.nth(1)).toHaveAccessibleName('Soyuducu qapısı açıq qalıb?');
  await expect(
    firstSectionItems.nth(1).getByRole('treeitem', { name: 'Nə qədər müddət açıq qalıb?' }),
  ).toBeVisible();
  await firstSectionItems
    .nth(1)
    .getByRole('button', { name: 'Soyuducu qapısı açıq qalıb?', exact: true })
    .click();
  const inspector = page.getByRole('complementary');
  await expect(inspector.getByLabel('Sualın mətni')).toHaveValue('Soyuducu qapısı açıq qalıb?');
  await expect(inspector.getByRole('checkbox', { name: 'Bəli' })).toBeChecked();
  await expect(inspector.getByLabel('Problem')).toHaveValue('critical');
  await expect(inspector.getByRole('checkbox', { name: 'Foto tələb et' })).toBeChecked();
});

function waitForDraftSave(page: Page): Promise<Response> {
  return page.waitForResponse((r) => r.url().includes('/draft') && r.request().method() === 'PUT' && r.ok());
}
