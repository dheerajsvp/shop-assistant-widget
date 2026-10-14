import { describe, expect, it } from 'vitest';
import { executeTool, mentionedProductIds, TOOLS, type ToolState } from './tools';

const fresh = (cart: ToolState['cart'] = []): ToolState => ({ cart: cart.map((l) => ({ ...l })), actions: [], addedIds: [] });

type Product = { id: string; price_inr: number; category: string };
const search = (args: Record<string, unknown>) =>
  executeTool('search_products', args, fresh()) as { count: number; products: Product[]; note?: string };

describe('search_products', () => {
  it('finds products by keyword', () => {
    const r = search({ query: 'running' });
    expect(r.products.map((p) => p.id)).toContain('stride-band');
  });

  it('respects price and category filters', () => {
    const r = search({ category: 'Audio', max_price: 5000 });
    expect(r.count).toBeGreaterThan(0);
    expect(r.products.every((p) => p.category === 'Audio' && p.price_inr <= 5000)).toBe(true);
  });

  it('accepts numbers sent as strings', () => {
    const r = search({ max_price: '2000' });
    expect(r.products.every((p) => p.price_inr <= 2000)).toBe(true);
  });

  it('falls back to best-rated within the filters when no keyword matches, and says so', () => {
    const r = search({ query: 'quantum spaceship', max_price: 3000 });
    expect(r.count).toBeGreaterThan(0);
    expect(r.note).toMatch(/No exact keyword match/);
  });

  it('reports an empty result when the filters match nothing', () => {
    const r = search({ max_price: 10 });
    expect(r.count).toBe(0);
    expect(r.note).toMatch(/No products match/);
  });

  it('sorts and limits', () => {
    const cheap = search({ sort: 'price_low_to_high', limit: 3 });
    expect(cheap.products).toHaveLength(3);
    expect(cheap.products[0].price_inr).toBeLessThanOrEqual(cheap.products[1].price_inr);
    expect(search({ limit: 99 }).products.length).toBeLessThanOrEqual(6);
  });
});

describe('cart tools', () => {
  it('adds a product, records the action and tracks the quantity', () => {
    const state = fresh();
    const r = executeTool('add_to_cart', { product_id: 'boom-speaker', quantity: 2 }, state) as { ok: boolean; quantity_in_cart: number };
    expect(r.ok).toBe(true);
    expect(r.quantity_in_cart).toBe(2);
    expect(state.actions).toEqual([{ type: 'ADD_TO_CART', productId: 'boom-speaker', quantity: 2 }]);
    expect(state.addedIds).toEqual(['boom-speaker']);
  });

  it('rejects unknown product ids without touching the cart', () => {
    const state = fresh();
    const r = executeTool('add_to_cart', { product_id: 'made-up-phone' }, state) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(state.actions).toEqual([]);
    expect(state.cart).toEqual([]);
  });

  it('caps a product at 10 and only reports what was actually added', () => {
    const state = fresh([{ productId: 'volt-charger', quantity: 9 }]);
    const r = executeTool('add_to_cart', { product_id: 'volt-charger', quantity: 5 }, state) as { quantity_added: number; quantity_in_cart: number };
    expect(r.quantity_added).toBe(1);
    expect(r.quantity_in_cart).toBe(10);
    const again = executeTool('add_to_cart', { product_id: 'volt-charger' }, state) as { ok: boolean };
    expect(again.ok).toBe(false);
  });

  it('clamps silly quantities', () => {
    const state = fresh();
    executeTool('add_to_cart', { product_id: 'volt-charger', quantity: -4 }, state);
    executeTool('add_to_cart', { product_id: 'brew-mug', quantity: 9999 }, state);
    expect(state.cart).toEqual([
      { productId: 'volt-charger', quantity: 1 },
      { productId: 'brew-mug', quantity: 10 },
    ]);
  });

  it('removes and clears', () => {
    const state = fresh([
      { productId: 'volt-charger', quantity: 1 },
      { productId: 'brew-mug', quantity: 2 },
    ]);
    expect((executeTool('remove_from_cart', { product_id: 'lumen-lamp' }, state) as { ok: boolean }).ok).toBe(false);
    expect((executeTool('remove_from_cart', { product_id: 'brew-mug' }, state) as { ok: boolean }).ok).toBe(true);
    expect(state.cart).toEqual([{ productId: 'volt-charger', quantity: 1 }]);
    expect((executeTool('clear_cart', {}, state) as { ok: boolean }).ok).toBe(true);
    expect((executeTool('clear_cart', {}, state) as { ok: boolean }).ok).toBe(false);
    expect(state.actions.map((a) => a.type)).toEqual(['REMOVE_FROM_CART', 'CLEAR_CART']);
  });

  it('views the cart with GST-inclusive totals', () => {
    const r = executeTool('view_cart', {}, fresh([{ productId: 'aura-headphones', quantity: 1 }, { productId: 'volt-charger', quantity: 2 }])) as {
      item_count: number;
      subtotal_inr: number;
      total_inr: number;
    };
    expect(r.item_count).toBe(3);
    expect(r.subtotal_inr).toBe(12999 + 2 * 1299);
    expect(r.total_inr).toBe(r.subtotal_inr); // above the free-delivery threshold
  });
});

describe('start_checkout', () => {
  it('refuses on an empty cart', () => {
    const state = fresh();
    expect((executeTool('start_checkout', {}, state) as { ok: boolean }).ok).toBe(false);
    expect(state.actions).toEqual([]);
  });

  it('opens checkout once, even if called twice', () => {
    const state = fresh([{ productId: 'volt-charger', quantity: 1 }]);
    executeTool('start_checkout', {}, state);
    executeTool('start_checkout', {}, state);
    expect(state.actions).toEqual([{ type: 'CHECKOUT' }]);
  });

  it('sees items added earlier in the same turn', () => {
    const state = fresh();
    executeTool('add_to_cart', { product_id: 'volt-charger' }, state);
    expect((executeTool('start_checkout', {}, state) as { ok: boolean }).ok).toBe(true);
  });
});

describe('executeTool safety', () => {
  it('returns errors as data for unknown tools and malformed args', () => {
    expect((executeTool('delete_everything', {}, fresh()) as { ok: boolean }).ok).toBe(false);
    expect(() => executeTool('add_to_cart', null, fresh())).not.toThrow();
    expect(() => executeTool('search_products', 'oops', fresh())).not.toThrow();
  });

  it('exposes a schema for every tool', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters.type).toBe('object');
    }
  });
});

describe('mentionedProductIds', () => {
  it('returns real products in order of first mention and ignores invented ones', () => {
    const text = 'Try the Volt Wireless Charger, or the Aura Wireless Headphones. The Zenith Quantum Phone is great too.';
    expect(mentionedProductIds(text)).toEqual(['volt-charger', 'aura-headphones']);
    expect(mentionedProductIds('We have lots of great stuff.')).toEqual([]);
  });
});
