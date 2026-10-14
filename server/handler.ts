/**
 * HTTP layer for `POST /api/chat`, written against the web-standard Request/Response so
 * the same code runs as a Netlify Function and inside the Vite dev/preview servers.
 */
import { AiError, runGemini, warmUp } from './gemini';
import { createRateLimiter } from './rateLimit';
import { ValidationError, parseChatRequest } from './validate';

export type HandlerEnv = Record<string, string | undefined>;

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
// Netlify cuts functions off at about 10 seconds by default, so stay under that.
const DEFAULT_DEADLINE_MS = 8500;
const MAX_BODY_BYTES = 20_000;

// The widget is embedded on other people's sites, so the endpoint must accept cross-origin calls.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const limiter = createRateLimiter([
  { windowMs: 60_000, max: 10 },
  { windowMs: 3_600_000, max: 80 },
]);

// Warm-up pings get their own small allowance, so they can never use up a visitor's chat allowance.
const warmLimiter = createRateLimiter([{ windowMs: 60_000, max: 4 }]);

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || /aborted|timed? ?out/i.test(err.message));

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function handleChatRequest(req: Request, env: HandlerEnv): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST, OPTIONS' });

  const apiKey = env.GEMINI_API_KEY;

  // `POST /api/chat?warm=1`: wake things up before the first real message. Always answers 204
  // and reveals nothing, whether or not it did any work.
  if (new URL(req.url).searchParams.get('warm') === '1') {
    if (apiKey && warmLimiter.check(clientKey(req)).ok) {
      await warmUp({ apiKey, model: env.GEMINI_MODEL || DEFAULT_MODEL, timeoutMs: 6000 });
    }
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!apiKey) return json({ error: 'The AI is not configured.' }, 503);

  const rate = limiter.check(clientKey(req));
  if (!rate.ok) return json({ error: 'Too many requests.' }, 429, { 'Retry-After': String(rate.retryAfterSec) });

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  try {
    const request = parseChatRequest(body);
    const reply = await runGemini(request, {
      apiKey,
      model: env.GEMINI_MODEL || DEFAULT_MODEL,
      deadlineMs: Number(env.AI_DEADLINE_MS) || DEFAULT_DEADLINE_MS,
    });
    return json(reply);
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, 400);
    // Log the cause for the owner, but never echo provider details (or anything key-like) to visitors.
    const message = err instanceof Error ? err.message.replace(/AIza[\w-]+/g, '[key]').slice(0, 300) : String(err);
    console.error('[chat] model call failed:', message);
    const upstream = (err as { status?: number })?.status;
    if (err instanceof AiError) return json({ error: 'The AI could not answer.' }, err.status);
    if (isAbort(err)) return json({ error: 'The AI took too long.' }, 504);
    if (upstream === 429) return json({ error: 'The AI is busy right now.' }, 429);
    return json({ error: 'The AI could not answer.' }, 502);
  }
}
