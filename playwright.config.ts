import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
