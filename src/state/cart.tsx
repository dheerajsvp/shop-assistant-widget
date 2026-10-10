import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { getProduct } from '../data/products';
import { computeTotals } from '../lib/pricing';
import { load, save } from '../lib/storage';
import type { CartLine } from '../types';
import { cartReducer, clampQty } from './cartReducer';
import { CartContext } from './useCart';

// This file only exports a component, so React Fast Refresh can hot-update it.
// The reducer lives in cartReducer.ts and the hook in useCart.ts.

const STORAGE_KEY = 'cart';

function loadCart(): CartLine[] {
  const stored = load<CartLine[]>(STORAGE_KEY, []);
  // Drop anything stale or malformed (e.g. a product removed from the catalogue).
  return Array.isArray(stored)
    ? stored
        .filter((l) => l && getProduct(l.productId) && l.quantity > 0)
        .map((l) => ({ ...l, quantity: clampQty(l.quantity) }))
    : [];
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, dispatch] = useReducer(cartReducer, undefined, loadCart);

  useEffect(() => save(STORAGE_KEY, lines), [lines]);

  const add = useCallback((productId: string, quantity = 1) => dispatch({ type: 'add', productId, quantity }), []);
  const setQty = useCallback((productId: string, quantity: number) => dispatch({ type: 'setQty', productId, quantity }), []);
  const remove = useCallback((productId: string) => dispatch({ type: 'remove', productId }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const value = useMemo(
    () => ({ lines, totals: computeTotals(lines, getProduct), add, setQty, remove, clear }),
    [lines, add, setQty, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
