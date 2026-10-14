/**
 * Embed entry point, built into a single `shop-assistant.js` file.
 *
 *   <script src="shop-assistant.js" data-brand-name="My Store" data-primary-color="#0EA5E9"></script>
 *
 * or, with data-auto-init="false":
 *
 *   ShopAssistant.init({ brandName: 'My Store', position: 'left' });
 *
 * The widget renders inside a Shadow DOM so the host page's CSS can't
 * affect it, and its CSS can't leak out onto the host page.
 */
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import type { WidgetBridge } from './components/Widget';
import { configFromDataset, resolveConfig, type WidgetConfig } from './config';
import styles from './styles.css?inline';

interface Instance {
  host: HTMLElement;
  root: Root;
  bridge: WidgetBridge;
}

let instance: Instance | null = null;

// Captured at load time; document.currentScript is null once the script finishes running.
const ownScript =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>('script[data-shop-assistant], script[src*="shop-assistant"], script[src*="/src/embed"]');

/**
 * The AI endpoint lives next to the widget script: wherever shop-assistant.js is served from,
 * its /api/chat is on the same origin. Works the same on a customer's site and in dev.
 */
function defaultAiEndpoint(): string | null {
  if (!ownScript?.src) return null;
  try {
    return new URL('/api/chat', ownScript.src).href;
  } catch {
    return null;
  }
}

export function init(options: Partial<WidgetConfig> = {}): void {
  if (instance) {
    console.warn('[ShopAssistant] Already initialised. Call ShopAssistant.destroy() first to re-initialise.');
    return;
  }
  const config = resolveConfig({ aiEndpoint: defaultAiEndpoint(), ...options });

  const host = document.createElement('div');
  host.id = 'shop-assistant-widget';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = styles;
  const mount = document.createElement('div');
  shadow.append(style, mount);
  document.body.appendChild(host);

  const bridge: WidgetBridge = {};
  const root = createRoot(mount);
  root.render(<App config={config} bridge={bridge} />);
  instance = { host, root, bridge };
}

function setOpen(value: boolean | ((prev: boolean) => boolean)) {
  if (!instance) return;
  if (instance.bridge.setOpen) instance.bridge.setOpen(value);
  else if (typeof value === 'boolean') instance.bridge.pendingOpen = value;
}

type Tab = 'chat' | 'shop' | 'cart';
const TABS: Tab[] = ['chat', 'shop', 'cart'];

/** Open the widget, optionally on a specific tab: ShopAssistant.open('shop'). */
export function open(tab?: Tab): void {
  setOpen(true);
  if (!instance || tab === undefined) return;
  if (!TABS.includes(tab)) {
    console.warn(`[ShopAssistant] Unknown tab "${tab}". Use one of: ${TABS.join(', ')}.`);
    return;
  }
  if (instance.bridge.navigate) instance.bridge.navigate(tab);
  else instance.bridge.pendingView = tab;
}

export const close = () => setOpen(false);
export const toggle = () => setOpen((o) => !o);

export function destroy(): void {
  if (!instance) return;
  instance.root.unmount();
  instance.host.remove();
  instance = null;
}

// Expose the API on window in dev too (the production IIFE build also assigns it).
(window as unknown as { ShopAssistant: unknown }).ShopAssistant = { init, open, close, toggle, destroy };

function autoInit() {
  const dataset = ownScript?.dataset ?? {};
  if (dataset.autoInit === 'false') return;
  init(configFromDataset(dataset));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit, { once: true });
} else {
  autoInit();
}
