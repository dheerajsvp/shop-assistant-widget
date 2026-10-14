import { describe, expect, it } from 'vitest';
import { ValidationError, parseChatRequest, redactSensitive } from './validate';

const user = (text: string) => ({ role: 'user', text });

describe('parseChatRequest', () => {
  it('accepts a normal request', () => {
    const r = parseChatRequest({
      messages: [{ role: 'bot', text: 'Hi!' }, user('show me speakers')],
      cart: [{ productId: 'boom-speaker', quantity: 2 }],
      shown: ['boom-speaker'],
      persona: { assistantName: 'Sage', brandName: 'Lumen & Co.' },
    });
    expect(r.messages).toHaveLength(2);
    expect(r.cart).toEqual([{ productId: 'boom-speaker', quantity: 2 }]);
    expect(r.shown).toEqual(['boom-speaker']);
  });

  it('rejects bodies that are not usable', () => {
    expect(() => parseChatRequest(null)).toThrow(ValidationError);
    expect(() => parseChatRequest({ messages: 'hi' })).toThrow(ValidationError);
    expect(() => parseChatRequest({ messages: [] })).toThrow(ValidationError);
    expect(() => parseChatRequest({ messages: [{ role: 'bot', text: 'hi' }] })).toThrow(/last message/);
    expect(() => parseChatRequest({ messages: [{ role: 'admin', text: 'hi' }] })).toThrow(ValidationError);
    expect(() => parseChatRequest({ messages: [user('   ')] })).toThrow(ValidationError);
  });

  it('keeps only the last 12 turns and truncates long text', () => {
    const many = Array.from({ length: 30 }, (_, i) => user(`message ${i}`));
    const r = parseChatRequest({ messages: many });
    expect(r.messages).toHaveLength(12);
    expect(r.messages[11].text).toBe('message 29');
    expect(parseChatRequest({ messages: [user('x'.repeat(5000))] }).messages[0].text).toHaveLength(600);
  });

  it('drops unknown product ids, duplicates and clamps quantities', () => {
    const r = parseChatRequest({
      messages: [user('hi')],
      cart: [
        { productId: 'nope', quantity: 1 },
        { productId: 'brew-mug', quantity: 999 },
        { productId: 'brew-mug', quantity: 1 },
        { productId: 'volt-charger', quantity: -3 },
        { productId: 7, quantity: 1 },
      ],
      shown: ['brew-mug', 'nope', 42],
    });
    expect(r.cart).toEqual([
      { productId: 'brew-mug', quantity: 10 },
      { productId: 'volt-charger', quantity: 1 },
    ]);
    expect(r.shown).toEqual(['brew-mug']);
  });
});

describe('redactSensitive', () => {
  it('removes card numbers in any common format', () => {
    expect(redactSensitive('my card is 4242 4242 4242 4242 ok')).toBe('my card is [card number removed] ok');
    expect(redactSensitive('4242-4242-4242-4242')).toBe('[card number removed]');
    expect(redactSensitive('4242424242424242')).toBe('[card number removed]');
  });

  it('removes CVV, emails and UPI IDs', () => {
    expect(redactSensitive('cvv 123')).toBe('cvv [removed]');
    expect(redactSensitive('CVV: 4567')).toBe('CVV [removed]');
    expect(redactSensitive('mail me at priya.sharma@example.com')).toBe('mail me at [email removed]');
    expect(redactSensitive('pay via priya@okaxis')).toBe('pay via [UPI ID removed]');
    expect(redactSensitive('9876543210@ybl')).toBe('[UPI ID removed]');
  });

  it('leaves normal shopping messages alone', () => {
    for (const text of [
      'headphones under ₹15,000',
      'show me speakers below 15000 rupees',
      'add 2 of them',
      'gift ideas under ₹2,000 for my dad',
      'call me on 98765 43210',
      'the Aura Wireless Headphones for ₹1,29,999',
    ]) {
      expect(redactSensitive(text)).toBe(text);
    }
  });

  it('is applied to every turn of a request', () => {
    const r = parseChatRequest({ messages: [user('card 4242 4242 4242 4242'), { role: 'bot', text: 'no!' }, user('cvv 123')] });
    expect(JSON.stringify(r)).not.toMatch(/4242|123/);
  });
});
