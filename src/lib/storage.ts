// localStorage can throw (private mode, blocked cookies, sandboxed iframes),
// so every access is guarded and the widget keeps working without persistence.

const PREFIX = 'shop-assistant:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Persistence is best-effort.
  }
}
