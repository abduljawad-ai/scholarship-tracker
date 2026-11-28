import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const paths = ['/', '/listing/chevening-pakistan/', '/archive/', '/my-applications/']

for (const path of paths) {
  test(`no serious axe violations on ${path}`, async ({ page }) => {
    // Scan with motion disabled: a fade-in caught mid-transition reads as low
    // contrast and makes the result depend on machine load.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(path)
    await page.evaluate(() => document.fonts.ready)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact!))).toEqual(
      [],
    )
  })

  test(`no horizontal overflow on ${path} at 375px`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(path)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(375)
  })
}
