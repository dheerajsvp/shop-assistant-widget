export interface RateLimit {
  windowMs: number;
  max: number;
}

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * A small sliding-window limiter, kept in memory.
 *
 * Serverless instances are short-lived and don't share memory, so this is best-effort
 * protection against one visitor hammering the endpoint. The hard backstop is the
 * model provider's own quota; when that's hit the widget falls back to its local brain.
 */
export function createRateLimiter(limits: RateLimit[], maxKeys = 5000) {
  const hits = new Map<string, number[]>();
  const longest = Math.max(...limits.map((l) => l.windowMs));

  return {
    check(key: string, now = Date.now()): RateResult {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < longest);
      for (const { windowMs, max } of limits) {
        const inWindow = recent.filter((t) => now - t < windowMs);
        if (inWindow.length >= max) {
          hits.set(key, recent);
          return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inWindow[0] + windowMs - now) / 1000)) };
        }
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return { ok: true };
    },
  };
}
