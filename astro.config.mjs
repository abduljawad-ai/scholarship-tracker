import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

// Placeholder production URL. The owner replaces it at deploy; the sitemap,
// canonical links and robots.txt must use the same origin.
const site = 'https://scholarship-tracker.pages.dev'

export default defineConfig({
  site,
  integrations: [
    sitemap({
      // A 404 page is not a destination and must not appear in the sitemap.
      filter: (page) => !page.includes('/404'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
