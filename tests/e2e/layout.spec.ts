import { expect, test } from '@playwright/test'

test('home renders header, footer, and a working theme toggle', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  const toggle = page.getByRole('button', { name: /theme/i })
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
})

test('home has no horizontal scroll at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth)
})
