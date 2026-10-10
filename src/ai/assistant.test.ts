import { describe, expect, it } from 'vitest';
import { PRODUCTS, getProduct } from '../data/products';
import type { CartLine } from '../types';
import { type AssistantContext, normalize, parsePrice as parseRaw, parseQuantity, respond, searchProducts } from './assistant';

const parsePrice = (text: string) => parseRaw(normalize(text));

const ctx = (overrides: Partial<AssistantContext> = {}): AssistantContext => ({
  products: PRODUCTS,
  cart: [],
  lastProducts: [],
  ...overrides,
});

const p = (id: string) => getProduct(id)!;

describe('entity extraction', () => {
  it('parses price ceilings, floors and ranges', () => {
    expect(parsePrice('headphones under ₹15,000')).toEqual({ max: 15000 });
    expect(parsePrice('something under 2000 rupees')).toEqual({ max: 2000 });
    expect(parsePrice('below Rs. 5000')).toEqual({ max: 5000 });
    expect(parsePrice('watch under 20k')).toEqual({ max: 20000 });
    expect(parsePrice('over 5 thousand')).toEqual({ min: 5000 });
    expect(parsePrice('between 1000 and 3k')).toEqual({ min: 1000, max: 3000 });
    expect(parsePrice('between ₹1,29,999 and 5000')).toEqual({ min: 5000, max: 129999 });
  });

  it('parses quantities without confusing them with prices or ordinals', () => {
    expect(parseQuantity('add 2 aura headphones')).toBe(2);
    expect(parseQuantity('add three chargers')).toBe(3);
    expect(parseQuantity('add the 2nd one')).toBe(1);
    expect(parseQuantity(normalize('add something under ₹5,000'))).toBe(1);
    expect(parseQuantity('add a speaker under 5k')).toBe(1);
  });
});

describe('search', () => {
  it('finds products by keyword and synonym', () => {
    expect(searchProducts('headphones', PRODUCTS).results[0].id).toBe('aura-headphones');
    expect(searchProducts('earphones', PRODUCTS).results[0].id).toBe('pulse-earbuds');
    expect(searchProducts('a coffee cup', PRODUCTS).results[0].id).toBe('brew-mug');
  });

  it('applies category and price filters', () => {
    const { results } = searchProducts('audio under 8000', PRODUCTS);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.category === 'Audio' && r.price <= 8000)).toBe(true);
  });
});

describe('respond', () => {
  it('greets, but treats "hey, show me headphones" as a search', () => {
    expect(respond('hello', ctx()).products).toBeUndefined();
    expect(respond('hey show me headphones', ctx()).products?.[0].id).toBe('aura-headphones');
  });

  it('returns product results for a voice-style query', () => {
    const reply = respond('Show me headphones under 15000 rupees.', ctx());
    expect(reply.products?.map((x) => x.id)).toContain('aura-headphones');
  });

  it('adds a product by name with a quantity', () => {
    const reply = respond('add 2 sunglasses to my cart', ctx());
    expect(reply.actions).toEqual([{ type: 'ADD_TO_CART', productId: 'shade-sunglasses', quantity: 2 }]);
  });

  it('resolves "the second one" against the previous results', () => {
    const lastProducts = [p('boom-speaker'), p('pulse-earbuds')];
    const reply = respond('add the second one', ctx({ lastProducts }));
    expect(reply.actions).toEqual([{ type: 'ADD_TO_CART', productId: 'pulse-earbuds', quantity: 1 }]);
  });

  it('resolves "it" when a single product is in context', () => {
    const reply = respond('add it to my cart', ctx({ lastProducts: [p('lumen-lamp')] }));
    expect(reply.actions?.[0]).toMatchObject({ type: 'ADD_TO_CART', productId: 'lumen-lamp' });
  });

  it('asks which product when "it" is ambiguous', () => {
    const reply = respond('add it', ctx({ lastProducts: [p('lumen-lamp'), p('brew-mug')] }));
    expect(reply.actions).toBeUndefined();
    expect(reply.text).toMatch(/which one/i);
  });

  it('starts checkout only when the cart has items', () => {
    expect(respond('checkout', ctx()).actions).toBeUndefined();
    const cart: CartLine[] = [{ productId: 'volt-charger', quantity: 1 }];
    expect(respond('checkout', ctx({ cart })).actions).toEqual([{ type: 'CHECKOUT' }]);
    expect(respond('buy now', ctx({ cart })).actions).toEqual([{ type: 'CHECKOUT' }]);
  });

  it('summarises, removes from and clears the cart', () => {
    const cart: CartLine[] = [
      { productId: 'volt-charger', quantity: 2 },
      { productId: 'orbit-watch', quantity: 1 },
    ];
    expect(respond("what's in my cart?", ctx({ cart })).text).toMatch(/3 items/);
    expect(respond('remove the smartwatch', ctx({ cart })).actions).toEqual([
      { type: 'REMOVE_FROM_CART', productId: 'orbit-watch' },
    ]);
    expect(respond('clear my cart', ctx({ cart })).actions).toEqual([{ type: 'CLEAR_CART' }]);
  });

  it('never removes a different item than the one named', () => {
    const cart: CartLine[] = [{ productId: 'aura-headphones', quantity: 1 }];
    const reply = respond('remove the wallet', ctx({ cart }));
    expect(reply.actions).toBeUndefined();
    expect(reply.text).toMatch(/isn't in your cart/);
    expect(respond('remove it', ctx({ cart })).actions).toEqual([{ type: 'REMOVE_FROM_CART', productId: 'aura-headphones' }]);
  });

  it('recommends gifts within a budget', () => {
    const reply = respond('gift ideas under ₹2,000', ctx());
    expect(reply.products?.length).toBeGreaterThan(0);
    expect(reply.products?.every((x) => x.price <= 2000)).toBe(true);
  });

  it('opens the catalogue on request', () => {
    expect(respond('browse the catalogue', ctx()).actions).toEqual([{ type: 'OPEN_CATALOG', category: undefined }]);
  });

  it('falls back gracefully on gibberish', () => {
    const reply = respond('qwzx blorp', ctx());
    expect(reply.actions).toBeUndefined();
    expect(reply.suggestions?.length).toBeGreaterThan(0);
  });
});
