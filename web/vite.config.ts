import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative base + hash routing: the build works at any path (GitHub Pages project sites).
// Preload the two latin font files so headline/body text doesn't wait for CSS to be parsed.
function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      const files = Object.keys(ctx.bundle ?? {}).filter((f) =>
        /(inter-latin-wght-normal|fraunces-latin-600-normal)[^/]*\.woff2$/.test(f))
      return {
        html,
        tags: files.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `./${f}`, crossorigin: '' }, injectTo: 'head' as const })),
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), preloadFonts()],
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
})
