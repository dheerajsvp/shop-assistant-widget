export interface WidgetConfig {
  /** Store name shown in the widget header. */
  brandName: string;
  /** Name of the assistant persona. */
  assistantName: string;
  /** Any CSS colour; drives buttons, bubbles and accents. */
  primaryColor: string;
  position: 'right' | 'left';
  theme: 'light' | 'dark' | 'auto';
  /** Open the panel as soon as the widget loads. */
  openOnLoad: boolean;
  /** Show the small "need help?" bubble next to the launcher. */
  showTeaser: boolean;
  /** First assistant message. */
  greeting: string;
}

export const DEFAULT_CONFIG: WidgetConfig = {
  brandName: 'Lumen & Co.',
  assistantName: 'Aria',
  primaryColor: '#6D5DF6',
  position: 'right',
  theme: 'auto',
  openOnLoad: false,
  showTeaser: true,
  greeting: '',
};

const bool = (v: string | undefined) => (v === undefined ? undefined : v !== 'false' && v !== '0');

/** Read config from `<script data-brand-name="..." data-primary-color="...">` attributes. */
export function configFromDataset(ds: DOMStringMap): Partial<WidgetConfig> {
  const cfg: Partial<WidgetConfig> = {};
  if (ds.brandName) cfg.brandName = ds.brandName;
  if (ds.assistantName) cfg.assistantName = ds.assistantName;
  if (ds.primaryColor) cfg.primaryColor = ds.primaryColor;
  if (ds.position === 'left' || ds.position === 'right') cfg.position = ds.position;
  if (ds.theme === 'light' || ds.theme === 'dark' || ds.theme === 'auto') cfg.theme = ds.theme;
  if (ds.greeting) cfg.greeting = ds.greeting;
  const openOnLoad = bool(ds.openOnLoad);
  if (openOnLoad !== undefined) cfg.openOnLoad = openOnLoad;
  const showTeaser = bool(ds.showTeaser);
  if (showTeaser !== undefined) cfg.showTeaser = showTeaser;
  return cfg;
}

export function resolveConfig(options: Partial<WidgetConfig>): WidgetConfig {
  const cfg = { ...DEFAULT_CONFIG, ...stripUndefined(options) };
  if (typeof CSS !== 'undefined' && !CSS.supports('color', cfg.primaryColor)) {
    console.warn(`[ShopAssistant] Invalid primaryColor "${cfg.primaryColor}", using default.`);
    cfg.primaryColor = DEFAULT_CONFIG.primaryColor;
  }
  if (!cfg.greeting) {
    cfg.greeting =
      `Hi! I'm ${cfg.assistantName}, your shopping assistant at ${cfg.brandName.replace(/\.$/, '')}. ` +
      'I can find products, add them to your cart and check you out. Type, or tap the mic and just talk.';
  }
  return cfg;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
