import { getProduct } from '../data/products';
import type { Product } from '../types';
import type { AssistantReply } from './assistant';
import type { ChatResponse } from './chatApi';

/** Quick-reply chips that match what just happened, since the AI doesn't write them. */
function suggestionsFor(ai: ChatResponse, products: Product[]): string[] | undefined {
  if (ai.actions.some((a) => a.type === 'CHECKOUT')) return undefined;
  if (ai.actions.some((a) => a.type === 'ADD_TO_CART')) return ['Checkout', 'View my cart', 'Keep shopping'];
  if (products.length > 1) return ['Add the first one', 'Show cheaper options'];
  if (products.length === 1) return ['Add it to my cart', 'Show similar items'];
  return undefined;
}

/**
 * Turn the server's reply into the widget's own reply shape. Product ids are looked up in
 * the local catalogue, so anything unknown simply drops out and only real products are shown.
 */
export function toReply(ai: ChatResponse): AssistantReply {
  const products = ai.productIds.map(getProduct).filter((p): p is Product => !!p);
  return {
    text: ai.text,
    products: products.length ? products : undefined,
    actions: ai.actions,
    focus: ai.focusId ? getProduct(ai.focusId) : undefined,
    suggestions: suggestionsFor(ai, products),
  };
}
