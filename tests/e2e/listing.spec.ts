import { expect, test } from '@playwright/test'

test('unverified apply link means no Apply button', async ({ page }) => {
  await page.goto('/listing/sindh-endowment-fund/')
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveCount(0)
  await expect(page.getByText(/check official page/i).first()).toBeVisible()
})

test('verified apply link shows the Apply button', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveAttribute('href', /^https:/)
})

test('guide, documents, and sources render', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await expect(page.getByRole('heading', { name: /how to apply/i })).toBeVisible()
  await expect(page.getByText(/documents/i).first()).toBeVisible()
  await expect(page.getByText(/last verified/i).first()).toBeVisible()
})

test('tracker save persists across reload', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.reload()
  await expect(page.getByText(/saved/i).first()).toBeVisible()
})

test('archived-only program page shows a closed cycle and no Apply button', async ({ page }) => {
  await page.goto('/listing/commonwealth-pakistan-2025/')
  await expect(page.getByText(/closed/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveCount(0)
})
