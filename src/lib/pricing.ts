import type { CartLine, Product, Totals } from '../types';

export const FREE_SHIPPING_THRESHOLD = 4999;
export const SHIPPING_FEE = 99;
/** Indian retail prices are GST-inclusive; we show the GST portion for transparency. */
export const GST_RATE = 0.18;

const round2 = (n: number) => Math.round(n * 100) / 100;

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const wholeCurrency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** "₹12,999" for whole amounts, "₹198.15" otherwise, with Indian digit grouping (₹1,29,999). */
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? wholeCurrency.format(amount) : currency.format(amount);
}

export function computeTotals(lines: CartLine[], lookup: (id: string) => Product | undefined): Totals {
  let subtotal = 0;
  let itemCount = 0;
  for (const line of lines) {
    const product = lookup(line.productId);
    if (!product) continue;
    subtotal += product.price * line.quantity;
    itemCount += line.quantity;
  }
  subtotal = round2(subtotal);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  // GST is already included in the product prices, so it is shown but not added.
  const tax = round2(subtotal - subtotal / (1 + GST_RATE));
  return { itemCount, subtotal, shipping, tax, total: round2(subtotal + shipping) };
}
