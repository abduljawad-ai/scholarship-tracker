import { expect, test } from '@playwright/test'

test('sample data notice is visible and dismissible per session', async ({ page }) => {
  await page.goto('/')
  const banner = page.getByTestId('freshness-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Demo data')
  await expect(banner).toContainText('automated updates are not connected yet')

  await page.getByRole('button', { name: /dismiss data status/i }).click()
  await expect(banner).toBeHidden()

  await page.reload()
  await expect(banner).toBeHidden()
})

test('freshness banner appears on every page', async ({ page }) => {
  for (const path of ['/about/', '/archive/', '/my-applications/']) {
    await page.goto(path)
    await expect(page.getByTestId('freshness-banner')).toBeVisible()
  }
})
