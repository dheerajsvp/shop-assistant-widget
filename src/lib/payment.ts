import type { CartLine, Customer, Order, Product, Totals } from '../types';

export type PaymentMethod = 'upi' | 'card';

export interface CheckoutForm extends Customer {
  method: PaymentMethod;
  upiId: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
}

export type CheckoutErrors = Partial<Record<keyof CheckoutForm, string>>;

export const EMPTY_FORM: CheckoutForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  pin: '',
  method: 'upi',
  upiId: '',
  cardNumber: '',
  expiry: '',
  cvc: '',
};

export const DEMO_FORM: CheckoutForm = {
  name: 'Priya Sharma',
  email: 'priya.sharma@example.com',
  phone: '98765 43210',
  address: '42, 100 Feet Road, Indiranagar',
  city: 'Bengaluru',
  pin: '560038',
  method: 'upi',
  upiId: 'priya@okaxis',
  cardNumber: '4242 4242 4242 4242',
  expiry: '12/29',
  cvc: '123',
};

/** Test credentials that always get declined, to demo the error path. */
export const DECLINED_CARD = '4000000000000002';
export const DECLINED_UPI = 'fail@upi';

export const digitsOnly = (s: string) => s.replace(/\D/g, '');

export function formatCardNumber(value: string): string {
  return digitsOnly(value).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatExpiry(value: string): string {
  const d = digitsOnly(value).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** "9876543210" → "98765 43210" */
export function formatPhone(value: string): string {
  const d = digitsOnly(value).slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

/** Luhn checksum, the same check real payment forms use to catch typos. */
export function luhnValid(cardNumber: string): boolean {
  const digits = digitsOnly(cardNumber);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function expiryValid(expiry: string, now = new Date()): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  // Cards are valid through the last day of the expiry month.
  return new Date(year, month, 1) > now;
}

/** UPI virtual payment address, e.g. name@okaxis, 9876543210@ybl. */
export const upiValid = (id: string) => /^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/i.test(id.trim());

/** Indian mobile numbers: 10 digits starting 6–9 (optional +91 / 0 prefix). */
export const phoneValid = (phone: string) => /^(?:91|0)?[6-9]\d{9}$/.test(digitsOnly(phone));

/** Indian PIN codes: 6 digits, never starting with 0. */
export const pinValid = (pin: string) => /^[1-9]\d{5}$/.test(pin.trim());

export function validateCheckout(form: CheckoutForm, now = new Date()): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (form.name.trim().length < 2) errors.name = 'Enter your full name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email';
  if (!phoneValid(form.phone)) errors.phone = 'Enter a 10-digit mobile number';
  if (form.address.trim().length < 4) errors.address = 'Enter your address';
  if (form.city.trim().length < 2) errors.city = 'Enter your city';
  if (!pinValid(form.pin)) errors.pin = 'Enter a 6-digit PIN code';
  if (form.method === 'upi') {
    if (!upiValid(form.upiId)) errors.upiId = 'Enter a valid UPI ID, e.g. name@okaxis';
  } else {
    if (!luhnValid(form.cardNumber)) errors.cardNumber = 'Enter a valid card number';
    if (!expiryValid(form.expiry, now)) errors.expiry = 'Use a future date (MM/YY)';
    if (!/^\d{3,4}$/.test(form.cvc)) errors.cvc = '3 or 4 digits';
  }
  return errors;
}

export type ChargeResult = { ok: true; transactionId: string } | { ok: false; reason: string };

/** Simulates a payment gateway round-trip (e.g. Razorpay / a UPI collect request). */
export function mockCharge(form: CheckoutForm, amount: number, delayMs = 1800): Promise<ChargeResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (form.method === 'card' && digitsOnly(form.cardNumber) === DECLINED_CARD) {
        resolve({ ok: false, reason: 'Your card was declined. Try a different card or pay with UPI.' });
      } else if (form.method === 'upi' && form.upiId.trim().toLowerCase() === DECLINED_UPI) {
        resolve({ ok: false, reason: 'The UPI payment request was declined. Please try again.' });
      } else if (amount <= 0) {
        resolve({ ok: false, reason: 'Your cart is empty.' });
      } else {
        resolve({ ok: true, transactionId: `pay_${randomId(14)}` });
      }
    }, delayMs);
  });
}

export function randomId(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function createOrder(params: {
  lines: CartLine[];
  lookup: (id: string) => Product | undefined;
  totals: Totals;
  form: CheckoutForm;
  transactionId: string;
  now?: Date;
}): Order {
  const now = params.now ?? new Date();
  const delivery = new Date(now);
  delivery.setDate(delivery.getDate() + 4);
  const { method, upiId, cardNumber, expiry: _expiry, cvc: _cvc, ...customer } = params.form;
  return {
    id: `ORD-${randomId(6)}`,
    items: params.lines.flatMap((line) => {
      const p = params.lookup(line.productId);
      return p ? [{ productId: p.id, name: p.name, emoji: p.emoji, price: p.price, quantity: line.quantity }] : [];
    }),
    totals: params.totals,
    customer,
    paidWith: method === 'upi' ? `UPI · ${upiId.trim()}` : `Card •••• ${digitsOnly(cardNumber).slice(-4)}`,
    transactionId: params.transactionId,
    placedAt: now.toISOString(),
    estimatedDelivery: delivery.toISOString(),
  };
}
