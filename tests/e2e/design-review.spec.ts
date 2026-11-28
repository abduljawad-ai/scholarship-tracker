import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const routes = [
  { path: '/', name: 'home' },
  { path: '/listing/chevening-pakistan/', name: 'listing' },
  { path: '/archive/', name: 'archive' },
  { path: '/my-applications/', name: 'my-applications' },
  { path: '/about/', name: 'about' },
  { path: '/does-not-exist/', name: '404' },
]

const viewports = [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

// Standalone touch targets must be at least 44x44 per the brief. Inline prose
// links are exempt, so only buttons, nav links, and form controls are measured.
const TARGET_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]'

async function smallTargets(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const problems: string[] = []
    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement)) continue
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (element.closest('[hidden]')) continue

      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      // Inline links inside a paragraph are exempt.
      if (element.tagName === 'A' && element.closest('p, li')) continue

      if (box.height < 43.5 || box.width < 43.5) {
        problems.push(
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} ` +
            `"${(element.textContent ?? '').trim().slice(0, 30)}" ` +
            `${Math.round(box.width)}x${Math.round(box.height)}`,
        )
      }
    }
    return problems
  }, TARGET_SELECTOR)
}

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

    test(`standalone targets are at least 44px on ${route.name} at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto(route.path)

      const problems = await smallTargets(page)
      expect(problems, problems.join('\n')).toEqual([])
    })
  }

  test(`no horizontal overflow on ${route.name} at 1024px`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(route.path)

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(1024)
  })
}

// The brief requires the same semantic tokens in dark mode. Capture the
// screens that exercise the most components: the register, the dossier and
// the long-form method page.
const darkRoutes = [
  { path: '/', name: 'home', width: 360, height: 800 },
  { path: '/listing/chevening-pakistan/', name: 'listing', width: 1440, height: 900 },
  { path: '/about/', name: 'about', width: 1440, height: 900 },
]

for (const route of darkRoutes) {
  test(`dark design shot: ${route.name} at ${route.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: route.width, height: route.height })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(route.path)

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(route.width)

    await page.screenshot({
      path: join(outputDir, `${route.name}-${route.width}-dark.png`),
      fullPage: true,
    })
  })
}
