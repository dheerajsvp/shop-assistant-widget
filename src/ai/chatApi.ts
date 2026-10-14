/**
 * The contract between the widget and the AI endpoint (`POST /api/chat`).
 *
 * The widget sends the recent conversation plus a little shop state; the server
 * replies with text, the ids of products to show, and actions for the widget to
 * run. Products travel as ids only, so the widget always renders its own
 * catalogue data and the model can never put made-up products on screen.
 */
import type { CartLine, Category } from '../types';
import type { AssistantAction } from './assistant';

export interface ChatTurn {
  role: 'user' | 'bot';
  text: string;
}

export interface ChatRequest {
  messages: ChatTurn[];
  cart: CartLine[];
  /** Ids of the products shown most recently, in order, so "the first one" can be resolved. */
  shown: string[];
  persona?: { assistantName?: string; brandName?: string };
}

export interface ChatResponse {
  text: string;
  productIds: string[];
  actions: AssistantAction[];
  /** The product the conversation is about, so "it" / "add it" keeps working. */
  focusId?: string;
}

export class AiUnavailableError extends Error {}

const CATEGORY_NAMES: Category[] = ['Audio', 'Wearables', 'Home', 'Bags', 'Accessories'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseAction(raw: unknown): AssistantAction | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'ADD_TO_CART': {
      const { productId, quantity } = raw;
      if (typeof productId !== 'string' || typeof quantity !== 'number') return null;
      return { type: 'ADD_TO_CART', productId, quantity: Math.min(10, Math.max(1, Math.round(quantity))) };
    }
    case 'REMOVE_FROM_CART':
      return typeof raw.productId === 'string' ? { type: 'REMOVE_FROM_CART', productId: raw.productId } : null;
    case 'CLEAR_CART':
    case 'OPEN_CART':
    case 'CHECKOUT':
      return { type: raw.type };
    case 'OPEN_CATALOG':
      return {
        type: 'OPEN_CATALOG',
        category: CATEGORY_NAMES.find((c) => c === raw.category),
      };
    default:
      return null;
  }
}

/** Never trust the network: accept only well-formed replies. */
export function parseChatResponse(data: unknown): ChatResponse {
  if (!isObject(data) || typeof data.text !== 'string' || !data.text.trim()) {
    throw new AiUnavailableError('Malformed AI response');
  }
  const productIds = Array.isArray(data.productIds)
    ? data.productIds.filter((id): id is string => typeof id === 'string').slice(0, 6)
    : [];
  const actions = Array.isArray(data.actions)
    ? data.actions.map(parseAction).filter((a): a is AssistantAction => a !== null)
    : [];
  return {
    text: data.text.trim(),
    productIds,
    actions,
    focusId: typeof data.focusId === 'string' ? data.focusId : undefined,
  };
}

/**
 * Fire-and-forget: wake the AI endpoint while the customer reads the greeting, so their first
 * real message isn't slowed by a cold start. Failures are ignored on purpose.
 */
export function warmUpSage(endpoint: string): void {
  try {
    const url = new URL(endpoint, window.location.href);
    url.searchParams.set('warm', '1');
    void fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {});
  } catch {
    // An unusable endpoint just means no warm-up.
  }
}

/** Ask the AI endpoint. Throws `AiUnavailableError` (or a network/abort error) on any failure. */
export async function askSage(endpoint: string, request: ChatRequest, timeoutMs = 15000): Promise<ChatResponse> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new AiUnavailableError(`AI endpoint returned ${res.status}`);
  return parseChatResponse(await res.json());
}
