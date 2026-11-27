import { expect, test } from '@playwright/test'

test('home has title, description, and OG tags', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/scholarship/i)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /scholarship/i)
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
})

test('about page carries the sourcing disclaimer', async ({ page }) => {
  await page.goto('/about/')
  await expect(page.getByText(/official sources/i)).toBeVisible()
})

test('unknown page shows a useful 404', async ({ page }) => {
  const response = await page.goto('/does-not-exist/')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /browse scholarships/i })).toBeVisible()
})

test('sitemap and robots are published', async ({ request }) => {
  const sitemap = await request.get('/sitemap-index.xml')
  expect(sitemap.status()).toBe(200)
  expect(await sitemap.text()).toContain('<sitemapindex')

  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain('Sitemap:')
})
