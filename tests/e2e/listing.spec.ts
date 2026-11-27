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

test('share link is hydrated in every cycle panel', async ({ page }) => {
  await page.goto('/listing/erasmus-mundus-joint-masters/')
  const links = page.locator('[data-share-link]')
  await expect(links).toHaveCount(2)
  const hrefs = await links.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''))
  for (const href of hrefs) {
    expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(href).toContain('erasmus-mundus-joint-masters')
  }
})
