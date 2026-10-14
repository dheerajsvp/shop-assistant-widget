import { describe, expect, it } from 'vitest';
import { AiUnavailableError, parseChatResponse } from './chatApi';
import { toReply } from './reply';

// The widget runs on other people's pages and calls a configurable endpoint, so it must not
// trust whatever comes back.
describe('parseChatResponse', () => {
  it('accepts a well-formed reply', () => {
    const r = parseChatResponse({
      text: ' Added! ',
      productIds: ['brew-mug'],
      actions: [{ type: 'ADD_TO_CART', productId: 'brew-mug', quantity: 2 }, { type: 'CHECKOUT' }],
      focusId: 'brew-mug',
    });
    expect(r.text).toBe('Added!');
    expect(r.actions).toEqual([{ type: 'ADD_TO_CART', productId: 'brew-mug', quantity: 2 }, { type: 'CHECKOUT' }]);
    expect(r.focusId).toBe('brew-mug');
  });

  it('rejects replies that are not usable', () => {
    for (const bad of [null, 'text', {}, { text: '' }, { text: '   ' }, { text: 42 }]) {
      expect(() => parseChatResponse(bad)).toThrow(AiUnavailableError);
    }
  });

  it('drops unknown or malformed actions instead of running them', () => {
    const r = parseChatResponse({
      text: 'ok',
      actions: [
        { type: 'DELETE_ACCOUNT' },
        { type: 'ADD_TO_CART', productId: 'brew-mug' },
        { type: 'ADD_TO_CART', quantity: 1 },
        'CHECKOUT',
        null,
        { type: 'REMOVE_FROM_CART', productId: 'brew-mug' },
      ],
    });
    expect(r.actions).toEqual([{ type: 'REMOVE_FROM_CART', productId: 'brew-mug' }]);
  });

  it('clamps quantities and ignores unknown categories', () => {
    const r = parseChatResponse({
      text: 'ok',
      actions: [
        { type: 'ADD_TO_CART', productId: 'brew-mug', quantity: 9999 },
        { type: 'OPEN_CATALOG', category: 'Weapons' },
        { type: 'OPEN_CATALOG', category: 'Audio' },
      ],
    });
    expect(r.actions).toEqual([
      { type: 'ADD_TO_CART', productId: 'brew-mug', quantity: 10 },
      { type: 'OPEN_CATALOG', category: undefined },
      { type: 'OPEN_CATALOG', category: 'Audio' },
    ]);
  });

  it('keeps only string product ids, and at most six', () => {
    const r = parseChatResponse({ text: 'ok', productIds: ['a', 1, null, 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(r.productIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('toReply', () => {
  it('shows only products that exist in the local catalogue', () => {
    const reply = toReply({ text: 'Try these', productIds: ['stride-band', 'invented-phone', 'pulse-earbuds'], actions: [] });
    expect(reply.products?.map((p) => p.id)).toEqual(['stride-band', 'pulse-earbuds']);
  });

  it('has no products at all when none are real', () => {
    expect(toReply({ text: 'hi', productIds: ['nope'], actions: [] }).products).toBeUndefined();
  });

  it('adds chips that match what just happened', () => {
    expect(toReply({ text: 'ok', productIds: [], actions: [{ type: 'ADD_TO_CART', productId: 'brew-mug', quantity: 1 }] }).suggestions).toContain('Checkout');
    expect(toReply({ text: 'ok', productIds: [], actions: [{ type: 'CHECKOUT' }] }).suggestions).toBeUndefined();
    expect(toReply({ text: 'ok', productIds: ['stride-band'], actions: [] }).suggestions).toContain('Add it to my cart');
    expect(toReply({ text: 'ok', productIds: ['stride-band', 'brew-mug'], actions: [] }).suggestions).toContain('Add the first one');
  });
});
