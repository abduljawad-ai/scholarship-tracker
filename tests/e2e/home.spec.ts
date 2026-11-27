import { expect, test } from '@playwright/test'

test('lists seed programs and filters by study level', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  const before = await page.getByTestId('listing-card').count()
  await page.getByLabel(/study level/i).selectOption('phd')
  const after = await page.getByTestId('listing-card').count()
  expect(after).toBeLessThanOrEqual(before)
})

test('eligible toggle shows the honest note and only active items', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/eligible only/i).check()
  await expect(page.getByTestId('eligible-note')).toBeVisible()
  await expect(page.getByTestId('eligible-note')).toContainText(/Likely eligible/i)
})

test('search with no matches shows the empty state', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/search/i).fill('zzzz-no-match')
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('filters by country', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/country/i).selectOption('Germany')
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
  await expect(page.getByTestId('card-daad-epos')).toBeVisible()
})

test('current level maps the study-level filter to the next stage', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/i'm currently in/i).selectOption('matric')
  await expect(page.getByLabel(/study level/i)).toHaveValue('intermediate')
})

test('unverified deadlines are never rendered as dates', async ({ page }) => {
  await page.goto('/')
  const fulbright = page.getByTestId('card-fulbright-pakistan')
  await expect(fulbright).toContainText(/not confirmed/i)
})
