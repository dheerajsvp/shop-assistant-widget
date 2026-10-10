import { describe, expect, it } from 'vitest';
import { getProduct } from '../data/products';
import {
  DEMO_FORM,
  EMPTY_FORM,
  expiryValid,
  formatCardNumber,
  formatPhone,
  luhnValid,
  phoneValid,
  pinValid,
  upiValid,
  validateCheckout,
} from './payment';
import { computeTotals, formatPrice, FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from './pricing';
import { cartReducer } from '../state/cartReducer';

describe('pricing (INR, GST-inclusive)', () => {
  it('formats rupees with Indian digit grouping', () => {
    expect(formatPrice(12999)).toBe('₹12,999');
    expect(formatPrice(129999)).toBe('₹1,29,999');
    expect(formatPrice(198.15)).toBe('₹198.15');
  });

  it('charges delivery below the free-delivery threshold and shows included GST', () => {
    const t = computeTotals([{ productId: 'volt-charger', quantity: 1 }], getProduct);
    expect(t.subtotal).toBe(1299);
    expect(t.shipping).toBe(SHIPPING_FEE);
    expect(t.tax).toBe(198.15); // 1299 - 1299 / 1.18
    expect(t.total).toBe(1398); // GST is inside the price, not added on top
  });

  it('delivers free at or above the threshold', () => {
    const t = computeTotals([{ productId: 'aura-headphones', quantity: 1 }], getProduct);
    expect(t.subtotal).toBeGreaterThanOrEqual(FREE_SHIPPING_THRESHOLD);
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(t.subtotal);
  });

  it('is all zeros for an empty cart', () => {
    expect(computeTotals([], getProduct)).toEqual({ itemCount: 0, subtotal: 0, shipping: 0, tax: 0, total: 0 });
  });
});

describe('payment validation', () => {
  it('validates card numbers with Luhn', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
  });

  it('formats card and phone numbers', () => {
    expect(formatCardNumber('4242424242424242999')).toBe('4242 4242 4242 4242');
    expect(formatPhone('9876543210')).toBe('98765 43210');
  });

  it('validates UPI IDs, Indian mobile numbers and PIN codes', () => {
    expect(upiValid('priya@okaxis')).toBe(true);
    expect(upiValid('9876543210@ybl')).toBe(true);
    expect(upiValid('priya.okaxis')).toBe(false);
    expect(phoneValid('98765 43210')).toBe(true);
    expect(phoneValid('+91 98765 43210')).toBe(true);
    expect(phoneValid('12345 67890')).toBe(false);
    expect(pinValid('560038')).toBe(true);
    expect(pinValid('060038')).toBe(false);
    expect(pinValid('5600')).toBe(false);
  });

  it('rejects expired cards', () => {
    const now = new Date(2026, 9, 10);
    expect(expiryValid('10/26', now)).toBe(true);
    expect(expiryValid('09/26', now)).toBe(false);
    expect(expiryValid('13/30', now)).toBe(false);
  });

  it('accepts the demo form with either payment method', () => {
    const now = new Date(2026, 9, 10);
    expect(validateCheckout(DEMO_FORM, now)).toEqual({});
    expect(validateCheckout({ ...DEMO_FORM, method: 'card' }, now)).toEqual({});
  });

  it('only validates the fields of the chosen payment method', () => {
    expect(Object.keys(validateCheckout(EMPTY_FORM)).sort()).toEqual(
      ['address', 'city', 'email', 'name', 'phone', 'pin', 'upiId'].sort(),
    );
    const cardErrors = validateCheckout({ ...EMPTY_FORM, method: 'card' });
    expect(cardErrors.upiId).toBeUndefined();
    expect(cardErrors.cardNumber).toBeDefined();
  });
});

describe('cart reducer', () => {
  it('merges repeated adds and caps quantity at 10', () => {
    let state = cartReducer([], { type: 'add', productId: 'brew-mug', quantity: 4 });
    state = cartReducer(state, { type: 'add', productId: 'brew-mug', quantity: 9 });
    expect(state).toEqual([{ productId: 'brew-mug', quantity: 10 }]);
  });

  it('removes a line when quantity drops to zero', () => {
    const state = cartReducer([{ productId: 'brew-mug', quantity: 1 }], { type: 'setQty', productId: 'brew-mug', quantity: 0 });
    expect(state).toEqual([]);
  });
});
