import type { CartLine } from '../types';

export const MAX_QTY = 10;

export type CartAction =
  | { type: 'add'; productId: string; quantity: number }
  | { type: 'setQty'; productId: string; quantity: number }
  | { type: 'remove'; productId: string }
  | { type: 'clear' };

export const clampQty = (n: number) => Math.min(MAX_QTY, Math.max(0, Math.floor(n)));

export function cartReducer(state: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case 'add': {
      const existing = state.find((l) => l.productId === action.productId);
      if (existing) {
        return state.map((l) =>
          l.productId === action.productId ? { ...l, quantity: clampQty(l.quantity + action.quantity) } : l,
        );
      }
      return [...state, { productId: action.productId, quantity: clampQty(action.quantity) }];
    }
    case 'setQty': {
      const quantity = clampQty(action.quantity);
      if (quantity === 0) return state.filter((l) => l.productId !== action.productId);
      return state.map((l) => (l.productId === action.productId ? { ...l, quantity } : l));
    }
    case 'remove':
      return state.filter((l) => l.productId !== action.productId);
    case 'clear':
      return [];
  }
}
