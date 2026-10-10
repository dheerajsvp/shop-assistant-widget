import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const BUNDLE_NAME = 'shop-assistant.js';
/** How the demo pages load the widget: exactly what a real site would paste. */
const PROD_SCRIPT = `src="./${BUNDLE_NAME}"`;
const DEV_SCRIPT = 'type="module" src="/src/embed.tsx"';
const DEMO_PAGES = ['index.html', 'one-line-embed.html'];

/**
 * The demo pages reference the production bundle (`./shop-assistant.js`).
 * - Dev server: that file doesn't exist yet, so point the tag at the source entry instead.
 * - Build: library mode ignores HTML files, so copy the pages into dist/ unchanged.
 *   This makes `dist/` a self-contained, deployable demo (Netlify / Vercel / GitHub Pages).
 */
function demoPagesPlugin(): Plugin {
  return {
    name: 'demo-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(PROD_SCRIPT, DEV_SCRIPT),
    },
    generateBundle() {
      for (const page of DEMO_PAGES) {
        const html = readFileSync(fileURLToPath(new URL(`./${page}`, import.meta.url)), 'utf-8');
        if (!html.includes(PROD_SCRIPT)) {
          this.error(`${page} must load the widget with: <script ${PROD_SCRIPT}>`);
        }
        this.emitFile({ type: 'asset', fileName: page, source: html });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), demoPagesPlugin()],
  // React reads process.env.NODE_ENV; library builds don't replace it automatically.
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: {
      entry: 'src/embed.tsx',
      name: 'ShopAssistant',
      formats: ['iife'],
      fileName: () => BUNDLE_NAME,
    },
  },
  test: {
    environment: 'node',
  },
}));
