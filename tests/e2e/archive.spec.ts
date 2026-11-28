import { expect, test } from '@playwright/test'

test('archive shows only closed programs and no Apply buttons', async ({ page }) => {
  await page.goto('/archive/')
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  await expect(page.getByText(/closed/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveCount(0)
})

test('archive excludes active programs and links to the official page', async ({ page }) => {
  await page.goto('/archive/')
  await expect(page.getByTestId('card-commonwealth-pakistan-2025')).toBeVisible()
  await expect(page.getByTestId('card-erasmus-mundus-joint-masters')).toHaveCount(0)
  await expect(
    page
      .getByTestId('card-commonwealth-pakistan-2025')
      .getByRole('link', { name: 'View official page (closed cycle)' }),
  ).toBeVisible()
  await expect(
    page.getByTestId('card-commonwealth-pakistan-2025').getByText('Closed', { exact: true }),
  ).toBeVisible()
})

test('archive search filters closed programs', async ({ page }) => {
  await page.goto('/archive/')
  await page.getByLabel(/search/i).fill('zzz')
  await expect(page.getByTestId('listing-card')).toHaveCount(0)
  await expect(page.getByTestId('empty-state')).toBeVisible()
})
