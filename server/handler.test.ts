import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, toContents } from './gemini';
import { handleChatRequest, type HandlerEnv } from './handler';

// Never call the real model in unit tests: offline, free and deterministic.
vi.mock('./gemini', async () => {
  const actual = await vi.importActual<typeof import('./gemini')>('./gemini');
  return { ...actual, runGemini: vi.fn() };
});
const { runGemini } = await import('./gemini');
const mockedRun = vi.mocked(runGemini);

const ENV: HandlerEnv = { GEMINI_API_KEY: 'test-key' };
let counter = 0;
/** A different visitor per test, so the rate limiter doesn't leak between tests. */
const post = (body: unknown, env: HandlerEnv = ENV, ip = `10.0.0.${++counter}`) =>
  handleChatRequest(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  );
const valid = { messages: [{ role: 'user', text: 'hi' }], cart: [], shown: [] };

beforeEach(() => {
  mockedRun.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handleChatRequest', () => {
  it('answers CORS preflight so the widget works on other websites', async () => {
    const res = await handleChatRequest(new Request('http://localhost/api/chat', { method: 'OPTIONS' }), ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('only accepts POST', async () => {
    const res = await handleChatRequest(new Request('http://localhost/api/chat'), ENV);
    expect(res.status).toBe(405);
  });

  it('reports that the AI is not configured when there is no key', async () => {
    expect((await post(valid, {})).status).toBe(503);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized bodies before calling the model', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ messages: [] })).status).toBe(400);
    expect((await post({ ...valid, pad: 'x'.repeat(30_000) })).status).toBe(413);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('returns the model reply with CORS headers and no caching', async () => {
    mockedRun.mockResolvedValue({ text: 'Hello!', productIds: ['brew-mug'], actions: [], focusId: 'brew-mug' });
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ text: 'Hello!', productIds: ['brew-mug'], actions: [], focusId: 'brew-mug' });
  });

  it('passes the configured model and a deadline to the model call', async () => {
    mockedRun.mockResolvedValue({ text: 'ok', productIds: [], actions: [] });
    await post(valid, { ...ENV, GEMINI_MODEL: 'gemini-test', AI_DEADLINE_MS: '5000' });
    expect(mockedRun.mock.calls[0][1]).toEqual({ apiKey: 'test-key', model: 'gemini-test', deadlineMs: 5000 });
    mockedRun.mockClear();
    await post(valid);
    expect(mockedRun.mock.calls[0][1].model).toBe('gemini-3.1-flash-lite');
  });

  it('maps failures to honest status codes the widget can fall back on', async () => {
    mockedRun.mockRejectedValueOnce(new AiError('too slow', 504));
    expect((await post(valid)).status).toBe(504);
    mockedRun.mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 }));
    expect((await post(valid)).status).toBe(429);
    mockedRun.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    expect((await post(valid)).status).toBe(504);
    mockedRun.mockRejectedValueOnce(new Error('boom'));
    expect((await post(valid)).status).toBe(502);
  });

  it('never leaks provider details or keys to visitors', async () => {
    // Assembled at runtime so the source never contains a key-shaped string (secret scanners flag those).
    const fakeKey = ['AI', 'za', 'SyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUM'].join('');
    mockedRun.mockRejectedValueOnce(new Error(`request failed for key ${fakeKey} at https://google`));
    const res = await post(valid);
    const body = await res.text();
    expect(body).not.toMatch(/AIza|google|request failed/);
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/AIza/);
  });

  it('rate-limits a visitor who sends too many requests', async () => {
    mockedRun.mockResolvedValue({ text: 'ok', productIds: [], actions: [] });
    const ip = '203.0.113.9';
    for (let i = 0; i < 10; i++) expect((await post(valid, ENV, ip)).status).toBe(200);
    const blocked = await post(valid, ENV, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Someone else is unaffected.
    expect((await post(valid, ENV, '203.0.113.10')).status).toBe(200);
  });
});

describe('toContents', () => {
  it('alternates roles, merges neighbours and starts with the user', () => {
    const contents = toContents([
      { role: 'bot', text: 'Hi, I am Sage' },
      { role: 'user', text: 'hello' },
      { role: 'user', text: 'show speakers' },
      { role: 'bot', text: 'Here you go' },
      { role: 'user', text: 'add the first' },
    ]);
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[0].parts).toHaveLength(2);
  });
});
