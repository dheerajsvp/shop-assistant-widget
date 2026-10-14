import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { createServer, loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

type HandlerEnv = Record<string, string | undefined>;
type ChatHandler = (req: Request, env: HandlerEnv) => Promise<Response>;

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

/**
 * Serve `POST /api/chat` locally by running the same handler the Netlify Function uses.
 * The server code is loaded through Vite on demand, so edits to it apply without a restart.
 */
function chatEndpointPlugin(): Plugin {
  let env: HandlerEnv = {};
  let root = process.cwd();
  let previewLoader: Promise<ViteDevServer> | undefined;

  const load = async (server: ViteDevServer): Promise<ChatHandler> =>
    (await server.ssrLoadModule('/server/handler.ts')).handleChatRequest as ChatHandler;

  const makeMiddleware = (getHandler: () => Promise<ChatHandler>): Connect.NextHandleFunction => async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 64_000) break;
        chunks.push(chunk as Buffer);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(`http://${req.headers.host ?? 'localhost'}/api/chat`, {
        method: req.method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      });
      const response = await (await getHandler())(request, env);
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error('[chat] dev endpoint error:', err instanceof Error ? err.message : err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Dev endpoint error.' }));
    }
  };

  return {
    name: 'chat-endpoint',
    configResolved(config) {
      // Reads .env (all variables, not just VITE_ ones). They stay on the server and are never sent to the browser.
      root = config.root;
      env = { ...loadEnv(config.mode, config.root, ''), ...process.env };
    },
    configureServer(server) {
      server.middlewares.use('/api/chat', makeMiddleware(() => load(server)));
    },
    configurePreviewServer(server) {
      // The preview server serves the built site and has no module loader of its own, so
      // borrow a quiet, headless Vite instance just to load the server code.
      previewLoader ??= createServer({
        root,
        configFile: false,
        appType: 'custom',
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false, watch: null },
      });
      server.middlewares.use('/api/chat', makeMiddleware(async () => load(await previewLoader!)));
      server.httpServer?.once('close', () => void previewLoader?.then((s) => s.close()));
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), demoPagesPlugin(), chatEndpointPlugin()],
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
