import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit, then blocks with a retry time', () => {
    const limiter = createRateLimiter([{ windowMs: 60_000, max: 3 }]);
    for (let i = 0; i < 3; i++) expect(limiter.check('a', 1000 + i).ok).toBe(true);
    const blocked = limiter.check('a', 1500);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBe(60); // oldest hit at t=1000 frees up at 61000
  });

  it('recovers once the window has passed', () => {
    const limiter = createRateLimiter([{ windowMs: 60_000, max: 1 }]);
    expect(limiter.check('a', 0).ok).toBe(true);
    expect(limiter.check('a', 30_000).ok).toBe(false);
    expect(limiter.check('a', 60_001).ok).toBe(true);
  });

  it('tracks visitors separately', () => {
    const limiter = createRateLimiter([{ windowMs: 60_000, max: 1 }]);
    expect(limiter.check('a', 0).ok).toBe(true);
    expect(limiter.check('b', 0).ok).toBe(true);
    expect(limiter.check('a', 1).ok).toBe(false);
  });

  it('enforces every window, e.g. a per-hour cap on top of a per-minute one', () => {
    const limiter = createRateLimiter([
      { windowMs: 60_000, max: 5 },
      { windowMs: 3_600_000, max: 6 },
    ]);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      expect(limiter.check('a', t).ok).toBe(true);
      t += 61_000; // spaced out, so only the hourly cap can trip
    }
    expect(limiter.check('a', t).ok).toBe(false);
  });

  it('does not grow without bound', () => {
    const limiter = createRateLimiter([{ windowMs: 60_000, max: 1 }], 10);
    for (let i = 0; i < 100; i++) limiter.check(`ip-${i}`, i);
    // The oldest visitors were forgotten, so they are allowed again.
    expect(limiter.check('ip-0', 200).ok).toBe(true);
  });
});
