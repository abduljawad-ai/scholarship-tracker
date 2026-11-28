import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { freshnessState, type RunStatus } from '../../src/lib/freshness'

// The banner follows the published run status. These tests assert the real
// state instead of assuming the site is still on sample data.
const status = JSON.parse(
  readFileSync('src/data/run-status.json', 'utf8'),
) as RunStatus
const state = freshnessState(status, new Date())

test('the data status notice matches the published run status', async ({ page }) => {
  await page.goto('/')
  const banner = page.getByTestId('freshness-banner')

  if (state === 'fresh') {
    await expect(banner).toBeHidden()
    return
  }

  await expect(banner).toBeVisible()
  if (state === 'sample') {
    await expect(banner).toContainText('Demo data')
    await expect(banner).toContainText('automated updates are not connected yet')
  } else {
    await expect(banner).toContainText(/Data last updated|has not been updated/)
  }
})

test('a visible notice is dismissible per session', async ({ page }) => {
  test.skip(state === 'fresh', 'the notice is hidden when the data is fresh')

  await page.goto('/')
  const banner = page.getByTestId('freshness-banner')
  await expect(banner).toBeVisible()

  await page.getByRole('button', { name: /dismiss data status/i }).click()
  await expect(banner).toBeHidden()

  await page.reload()
  await expect(banner).toBeHidden()
})

test('every page carries the data status element', async ({ page }) => {
  for (const path of ['/about/', '/archive/', '/my-applications/']) {
    await page.goto(path)
    const banner = page.getByTestId('freshness-banner')
    await expect(banner).toBeAttached()
    if (state !== 'fresh') await expect(banner).toBeVisible()
  }
})
