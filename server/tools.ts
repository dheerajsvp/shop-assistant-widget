/**
 * The tools the AI model may call.
 *
 * Provider-neutral on purpose: each tool is a name, a description, a JSON schema and a
 * plain function. `gemini.ts` adapts them to Gemini; another provider (Claude, OpenAI)
 * would only need its own small adapter.
 *
 * Tools run on the server against the real catalogue, so the model can only ever talk
 * about products that exist. Cart changes are recorded as `actions` for the widget to
 * run in the browser, where the real cart lives.
 */
import { keywordTokens, scoreProduct, type AssistantAction } from '../src/ai/assistant';
import { CATEGORIES, PRODUCTS, getProduct } from '../src/data/products';
import { FREE_SHIPPING_THRESHOLD, computeTotals } from '../src/lib/pricing';
import { MAX_QTY } from '../src/state/cartReducer';
import type { CartLine, Category, Product } from '../src/types';

/** What a conversation turn changes. Created fresh for every request. */
export interface ToolState {
  cart: CartLine[];
  actions: AssistantAction[];
  addedIds: string[];
}

type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Args, state: ToolState): unknown;
}

// ---------------------------------------------------------------- helpers

const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

const asCategory = (v: unknown): Category | undefined =>
  CATEGORIES.find((c) => c.toLowerCase() === asString(v).toLowerCase());

const asQuantity = (v: unknown) => Math.min(MAX_QTY, Math.max(1, Math.round(asNumber(v) ?? 1)));

function productView(p: Product) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price_inr: p.price,
    original_price_inr: p.compareAt ?? null,
    rating: p.rating,
    summary: p.tagline,
    features: p.features,
    keywords: p.tags,
  };
}

function cartView(state: ToolState) {
  const totals = computeTotals(state.cart, getProduct);
  return {
    items: state.cart.flatMap((line) => {
      const p = getProduct(line.productId);
      return p
        ? [
            {
              id: p.id,
              name: p.name,
              quantity: line.quantity,
              unit_price_inr: p.price,
              line_total_inr: p.price * line.quantity,
            },
          ]
        : [];
    }),
    item_count: totals.itemCount,
    subtotal_inr: totals.subtotal,
    delivery_inr: totals.shipping,
    gst_included_inr: totals.tax,
    total_inr: totals.total,
    free_delivery_above_inr: FREE_SHIPPING_THRESHOLD,
  };
}

const unknownProduct = (id: string) => ({
  ok: false,
  error: `No product with id "${id}". Use an id returned by search_products.`,
});

// ---------------------------------------------------------------- tools

const noParams = { type: 'object', properties: {} };
const productIdParam = {
  type: 'object',
  properties: { product_id: { type: 'string', description: 'The id of the product, as returned by search_products.' } },
  required: ['product_id'],
};

export const TOOLS: ToolDef[] = [
  {
    name: 'search_products',
    description:
      'Search the store catalogue. Use this whenever the customer wants to find, browse or compare products. ' +
      'Prices are in Indian rupees (INR). Returns up to 6 products.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product keywords, e.g. "running", "headphones", "gift for dad". Leave empty to browse.',
        },
        category: { type: 'string', enum: [...CATEGORIES], description: 'Only products in this category.' },
        min_price: { type: 'number', description: 'Minimum price in rupees.' },
        max_price: { type: 'number', description: 'Maximum price in rupees.' },
        sort: {
          type: 'string',
          enum: ['relevance', 'price_low_to_high', 'price_high_to_low', 'rating'],
          description: 'Defaults to relevance.',
        },
        limit: { type: 'integer', description: 'How many products to return (1-6). Defaults to 5.' },
      },
    },
    run(args) {
      const category = asCategory(args.category);
      const min = asNumber(args.min_price);
      const max = asNumber(args.max_price);
      const pool = PRODUCTS.filter(
        (p) => (!category || p.category === category) && (min === undefined || p.price >= min) && (max === undefined || p.price <= max),
      );
      if (pool.length === 0) return { count: 0, products: [], note: 'No products match these filters.' };

      const tokens = keywordTokens(asString(args.query));
      let results = [...pool].sort((a, b) => b.rating - a.rating);
      let note: string | undefined;
      if (tokens.length) {
        const matched = pool
          .map((p) => ({ p, score: scoreProduct(p, tokens) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating)
          .map((x) => x.p);
        if (matched.length) results = matched;
        else note = 'No exact keyword match, so these are the best-rated items within the filters. Judge their relevance yourself.';
      }

      switch (args.sort) {
        case 'price_low_to_high':
          results.sort((a, b) => a.price - b.price);
          break;
        case 'price_high_to_low':
          results.sort((a, b) => b.price - a.price);
          break;
        case 'rating':
          results.sort((a, b) => b.rating - a.rating);
          break;
      }

      const limit = Math.min(6, Math.max(1, Math.round(asNumber(args.limit) ?? 5)));
      const products = results.slice(0, limit).map(productView);
      return { count: products.length, products, ...(note ? { note } : {}) };
    },
  },
  {
    name: 'get_product',
    description: 'Get the full details of one product by id.',
    parameters: productIdParam,
    run(args) {
      const id = asString(args.product_id);
      const p = getProduct(id);
      return p ? { ok: true, product: { ...productView(p), description: p.description } } : unknownProduct(id);
    },
  },
  {
    name: 'add_to_cart',
    description:
      'Add a product to the customer\'s cart. Only say it was added if this returns ok: true. ' +
      `At most ${MAX_QTY} of one product can be in the cart.`,
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The id of the product.' },
        quantity: { type: 'integer', description: 'How many to add. Defaults to 1.' },
      },
      required: ['product_id'],
    },
    run(args, state) {
      const id = asString(args.product_id);
      const p = getProduct(id);
      if (!p) return unknownProduct(id);
      const existing = state.cart.find((l) => l.productId === id);
      const room = MAX_QTY - (existing?.quantity ?? 0);
      if (room <= 0) return { ok: false, error: `The cart already has the maximum of ${MAX_QTY} of ${p.name}.` };
      const quantity = Math.min(asQuantity(args.quantity), room);
      if (existing) existing.quantity += quantity;
      else state.cart.push({ productId: id, quantity });
      state.actions.push({ type: 'ADD_TO_CART', productId: id, quantity });
      state.addedIds.push(id);
      const line = state.cart.find((l) => l.productId === id);
      return { ok: true, added: p.name, quantity_added: quantity, quantity_in_cart: line?.quantity, cart: cartView(state) };
    },
  },
  {
    name: 'remove_from_cart',
    description: 'Remove a product from the cart completely.',
    parameters: productIdParam,
    run(args, state) {
      const id = asString(args.product_id);
      const p = getProduct(id);
      if (!p) return unknownProduct(id);
      if (!state.cart.some((l) => l.productId === id)) return { ok: false, error: `${p.name} is not in the cart.` };
      state.cart = state.cart.filter((l) => l.productId !== id);
      state.actions.push({ type: 'REMOVE_FROM_CART', productId: id });
      return { ok: true, removed: p.name, cart: cartView(state) };
    },
  },
  {
    name: 'clear_cart',
    description: 'Empty the whole cart.',
    parameters: noParams,
    run(_args, state) {
      if (state.cart.length === 0) return { ok: false, error: 'The cart is already empty.' };
      state.cart = [];
      state.actions.push({ type: 'CLEAR_CART' });
      return { ok: true };
    },
  },
  {
    name: 'view_cart',
    description: 'Show what is in the cart, with totals in rupees. Prices already include 18% GST.',
    parameters: noParams,
    run(_args, state) {
      return { ok: true, ...cartView(state) };
    },
  },
  {
    name: 'start_checkout',
    description:
      'Open the secure checkout screen so the customer can pay. Call it when the customer wants to buy, pay or check out. ' +
      'Payment details are entered by the customer on that screen, never in chat.',
    parameters: noParams,
    run(_args, state) {
      if (state.cart.length === 0) return { ok: false, error: 'The cart is empty, so there is nothing to check out.' };
      if (!state.actions.some((a) => a.type === 'CHECKOUT')) state.actions.push({ type: 'CHECKOUT' });
      return { ok: true, total_inr: computeTotals(state.cart, getProduct).total };
    },
  },
  {
    name: 'open_catalogue',
    description: 'Open the full product catalogue screen, optionally on one category. Use when the customer wants to browse everything.',
    parameters: {
      type: 'object',
      properties: { category: { type: 'string', enum: [...CATEGORIES] } },
    },
    run(args, state) {
      state.actions.push({ type: 'OPEN_CATALOG', category: asCategory(args.category) });
      return { ok: true };
    },
  },
];

/** Run a tool the model asked for. Never throws: failures go back to the model as data. */
export function executeTool(name: string, args: unknown, state: ToolState): unknown {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
  try {
    return tool.run(typeof args === 'object' && args !== null ? (args as Args) : {}, state);
  } catch {
    return { ok: false, error: 'That tool failed. Try again or answer without it.' };
  }
}

/**
 * A plain-English summary of what the tools did, used when the model can't write its own
 * closing sentence (it ran out of time): the actions have already happened, so say so.
 */
export function summarizeActions(actions: AssistantAction[]): string {
  const parts = actions.flatMap((a): string[] => {
    switch (a.type) {
      case 'ADD_TO_CART': {
        const p = getProduct(a.productId);
        return p ? [`added ${a.quantity > 1 ? `${a.quantity} × ` : ''}${p.name} to your cart`] : [];
      }
      case 'REMOVE_FROM_CART': {
        const p = getProduct(a.productId);
        return p ? [`removed ${p.name} from your cart`] : [];
      }
      case 'CLEAR_CART':
        return ['cleared your cart'];
      case 'CHECKOUT':
        return ['opened checkout'];
      case 'OPEN_CATALOG':
        return ['opened the catalogue'];
      default:
        return [];
    }
  });
  if (parts.length === 0) return 'Done!';
  const sentence = parts.join(', ');
  return `Done, I ${sentence}.`;
}

/**
 * Product cards are chosen from the product names the model actually wrote, in order of
 * first mention. Names that aren't real products simply don't match, so nothing invented
 * can reach the screen.
 */
export function mentionedProductIds(text: string): string[] {
  const lower = text.toLowerCase();
  return PRODUCTS.map((p) => ({ id: p.id, at: lower.indexOf(p.name.toLowerCase()) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.id);
}
