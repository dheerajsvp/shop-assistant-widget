import { getProduct } from '../src/data/products';
import type { ChatRequest, ChatTurn } from '../src/ai/chatApi';
import { MAX_QTY } from '../src/state/cartReducer';
import type { CartLine } from '../src/types';

export class ValidationError extends Error {}

const MAX_TURNS = 12;
const MAX_TEXT = 600;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Payment details and personal data must never reach the model, even if a customer types
 * them into the chat. The widget resends the whole conversation each turn, so redacting
 * here also stops them being forwarded again on every later message.
 */
export function redactSensitive(text: string): string {
  return text
    // Card numbers: 13-19 digits, optionally separated by spaces or hyphens.
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[card number removed]')
    // CVV / CVC / security code followed by its digits.
    .replace(/\b(cvv|cvc|security code)\b\D{0,6}\d{3,4}\b/gi, '$1 [removed]')
    // Emails.
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email removed]')
    // UPI IDs look like name@bank (no dot after the @, unlike an email).
    .replace(/\b[\w.-]{2,}@[a-z]{2,20}\b/gi, '[UPI ID removed]');
}

/**
 * Turn an untrusted request body into a safe `ChatRequest`: bounded sizes, known roles,
 * only real product ids, quantities in range. Anything that can't be repaired throws.
 */
export function parseChatRequest(raw: unknown): ChatRequest {
  if (!isObject(raw)) throw new ValidationError('Body must be a JSON object.');

  if (!Array.isArray(raw.messages)) throw new ValidationError('messages must be an array.');
  const turns: ChatTurn[] = [];
  for (const item of raw.messages.slice(-MAX_TURNS)) {
    if (!isObject(item) || (item.role !== 'user' && item.role !== 'bot') || typeof item.text !== 'string') {
      throw new ValidationError('Each message needs a role ("user" or "bot") and text.');
    }
    const text = redactSensitive(item.text.trim().slice(0, MAX_TEXT));
    if (text) turns.push({ role: item.role, text });
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    throw new ValidationError('The last message must be from the user.');
  }

  const cart: CartLine[] = [];
  if (Array.isArray(raw.cart)) {
    for (const line of raw.cart.slice(0, 30)) {
      if (!isObject(line) || typeof line.productId !== 'string' || typeof line.quantity !== 'number') continue;
      if (!getProduct(line.productId) || cart.some((l) => l.productId === line.productId)) continue;
      const quantity = Math.min(MAX_QTY, Math.max(1, Math.round(line.quantity)));
      cart.push({ productId: line.productId, quantity });
    }
  }

  const shown = Array.isArray(raw.shown)
    ? raw.shown.filter((id): id is string => typeof id === 'string' && !!getProduct(id)).slice(0, 6)
    : [];

  const persona = isObject(raw.persona)
    ? {
        assistantName: typeof raw.persona.assistantName === 'string' ? raw.persona.assistantName : undefined,
        brandName: typeof raw.persona.brandName === 'string' ? raw.persona.brandName : undefined,
      }
    : undefined;

  return { messages: turns, cart, shown, persona };
}
