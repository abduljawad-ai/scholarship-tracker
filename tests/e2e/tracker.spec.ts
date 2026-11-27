import { expect, test } from '@playwright/test'

test('saved listing appears in My Applications and can be exported', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/my-applications/')
  await expect(page.getByTestId('tracker-entry')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /export/i })).toBeVisible()
})

test('status and note persist across reload', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/my-applications/')

  await page.getByTestId('tracker-status').selectOption('applied')
  await page.getByTestId('tracker-note').fill('Need two references')
  await page.reload()

  await expect(page.getByTestId('tracker-status')).toHaveValue('applied')
  await expect(page.getByTestId('tracker-note')).toHaveValue('Need two references')
})

test('invalid backup code shows an error', async ({ page }) => {
  await page.goto('/my-applications/')
  await page.getByTestId('import-code').fill('not-a-valid-code')
  await page.getByTestId('import-tracker').click()

  await expect(page.getByTestId('import-error')).toBeVisible()
  await expect(page.getByTestId('import-error')).toContainText(/not valid/i)
})

test('exported code restores saved applications after storage is cleared', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/my-applications/')

  await page.getByTestId('export-tracker').click()
  const code = await page.getByTestId('export-code').inputValue()
  expect(code.length).toBeGreaterThan(0)

  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByTestId('tracker-entry')).toHaveCount(0)
  await expect(page.getByTestId('tracker-empty')).toBeVisible()

  await page.getByTestId('import-code').fill(code)
  await page.getByTestId('import-tracker').click()

  await expect(page.getByTestId('tracker-entry')).toHaveCount(1)
  await expect(page.getByTestId('import-success')).toBeVisible()
})

test('saved application can be removed', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/my-applications/')

  await page.getByTestId('tracker-remove').click()

  await expect(page.getByTestId('tracker-entry')).toHaveCount(0)
  await expect(page.getByTestId('tracker-empty')).toBeVisible()
})
