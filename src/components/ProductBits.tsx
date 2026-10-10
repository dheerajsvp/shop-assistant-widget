import type { KeyboardEvent, MouseEvent } from 'react';
import { formatPrice } from '../lib/pricing';
import { MAX_QTY } from '../state/cartReducer';
import { useCart } from '../state/useCart';
import type { Product } from '../types';
import { MinusIcon, PlusIcon, StarIcon } from './Icons';

export function ProductTile({ product, size = 'md' }: { product: Product; size?: 'sm' | 'md' | 'lg' }) {
  const [a, b] = product.colors;
  return (
    <div className={`sa-tile sa-tile--${size}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      <span className="sa-tile__emoji" aria-hidden="true">
        {product.emoji}
      </span>
      {product.badge && size !== 'sm' && (
        <span className={`sa-badge sa-badge--${product.badge.toLowerCase()}`}>{product.badge}</span>
      )}
    </div>
  );
}

export function Rating({ product }: { product: Product }) {
  return (
    <span className="sa-rating" aria-label={`Rated ${product.rating} out of 5 by ${product.reviews} customers`}>
      <StarIcon size={13} />
      {product.rating.toFixed(1)}
      <span className="sa-muted">({product.reviews.toLocaleString('en-IN')})</span>
    </span>
  );
}

export function Price({ product }: { product: Product }) {
  return (
    <span className="sa-price">
      {formatPrice(product.price)}
      {product.compareAt && <s className="sa-price__was">{formatPrice(product.compareAt)}</s>}
    </span>
  );
}

/**
 * Quick-commerce style cart control (like Blinkit / Instamart):
 * shows "+" when the product isn't in the cart, and a "− qty +" counter once it is.
 * The quantity always reflects the cart, whether items were added here, by voice or in the Cart tab.
 */
export function CartControl({ product, onAdd }: { product: Product; onAdd: (p: Product, quiet: boolean) => void }) {
  const { lines, setQty } = useCart();
  const qty = lines.find((l) => l.productId === product.id)?.quantity ?? 0;

  // The control sits on a clickable card; keep clicks and key presses from also opening the product.
  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

  if (qty === 0) {
    return (
      <button
        type="button"
        className="sa-ctl sa-ctl--add"
        aria-label={`Add ${product.name} to cart`}
        onClick={(e) => {
          stop(e);
          onAdd(product, false);
        }}
        onKeyDown={stop}
      >
        <PlusIcon size={18} strokeWidth={2.6} />
      </button>
    );
  }

  return (
    <div className="sa-ctl sa-ctl--qty" role="group" aria-label={`${product.name}: ${qty} in cart`} onClick={stop} onKeyDown={stop}>
      <button type="button" onClick={() => setQty(product.id, qty - 1)} aria-label={qty === 1 ? `Remove ${product.name} from cart` : `Remove one ${product.name}`}>
        <MinusIcon size={15} strokeWidth={2.6} />
      </button>
      <span key={qty} className="sa-ctl__count" aria-live="polite">
        {qty}
      </span>
      <button type="button" onClick={() => onAdd(product, true)} disabled={qty >= MAX_QTY} aria-label={`Add one more ${product.name}`}>
        <PlusIcon size={15} strokeWidth={2.6} />
      </button>
    </div>
  );
}

export function QtyStepper({
  value,
  onChange,
  max = MAX_QTY,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  label: string;
}) {
  return (
    <div className="sa-qty" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label="Decrease quantity">
        <MinusIcon size={14} />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
