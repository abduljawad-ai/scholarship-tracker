import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const routes = [
  { path: '/', name: 'home' },
  { path: '/listing/chevening-pakistan/', name: 'listing' },
  { path: '/archive/', name: 'archive' },
  { path: '/my-applications/', name: 'my-applications' },
]

const viewports = [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

const outputDir = join(process.cwd(), 'test-results', 'design-review')

test.beforeAll(() => {
  mkdirSync(outputDir, { recursive: true })
})

for (const route of routes) {
  for (const viewport of viewports) {
    test(`design shot: ${route.name} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto(route.path)

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width)

      await page.screenshot({
        path: join(outputDir, `${route.name}-${viewport.width}.png`),
        fullPage: true,
      })
    })
  }

  test(`no horizontal overflow on ${route.name} at 1024px`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(route.path)

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(1024)
  })
}
