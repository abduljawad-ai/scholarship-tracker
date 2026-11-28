import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  // Two workers keep peak Chromium memory inside a 7 GB runner. With the
  // default (half the cores) axe scans can crash a tab on a busy machine.
  workers: 2,
  use: {
    baseURL: 'http://localhost:4322',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npx astro preview --ignore-lock --port 4322',
    url: 'http://localhost:4322',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
