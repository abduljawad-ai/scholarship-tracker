import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

// Stable production URL (Cloudflare Pages alias). Use the alias, never a
// per-deployment hash URL: canonical links, the sitemap and robots.txt must
// keep one origin across deployments.
const site = 'https://scholarships-pk.pages.dev'

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
