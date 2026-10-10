import { getProduct } from '../data/products';
import { FREE_SHIPPING_THRESHOLD, formatPrice } from '../lib/pricing';
import { useCart } from '../state/useCart';
import type { Product } from '../types';
import { LockIcon, TrashIcon, TruckIcon } from './Icons';
import { ProductTile, QtyStepper } from './ProductBits';

interface CartViewProps {
  onCheckout: () => void;
  onBrowse: () => void;
  onOpenProduct: (p: Product) => void;
}

export function CartView({ onCheckout, onBrowse, onOpenProduct }: CartViewProps) {
  const { lines, totals, setQty, remove } = useCart();

  if (lines.length === 0) {
    return (
      <div className="sa-empty">
        <div className="sa-empty__emoji">🛒</div>
        <h3>Your cart is empty</h3>
        <p className="sa-muted">Browse the catalogue or ask the assistant for ideas.</p>
        <button type="button" className="sa-btn" onClick={onBrowse}>
          Start shopping
        </button>
      </div>
    );
  }

  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - totals.subtotal);
  const progress = Math.min(100, (totals.subtotal / FREE_SHIPPING_THRESHOLD) * 100);

  return (
    <div className="sa-cart">
      <div className="sa-shipping">
        <TruckIcon size={16} />
        <span>
          {remaining > 0 ? (
            <>
              Add <strong>{formatPrice(remaining)}</strong> more for free delivery
            </>
          ) : (
            <>You've unlocked <strong>free delivery</strong> 🎉</>
          )}
        </span>
        <div className="sa-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div style={{ width: `${progress}%` }} />
        </div>
      </div>

      <ul className="sa-lines">
        {lines.map((line) => {
          const p = getProduct(line.productId);
          if (!p) return null;
          return (
            <li key={p.id} className="sa-line">
              <button type="button" className="sa-line__tile" onClick={() => onOpenProduct(p)} aria-label={`View ${p.name}`}>
                <ProductTile product={p} size="sm" />
              </button>
              <div className="sa-line__info">
                <div className="sa-line__name">{p.name}</div>
                <div className="sa-muted">{formatPrice(p.price)} each</div>
                <QtyStepper value={line.quantity} onChange={(n) => setQty(p.id, n)} label={p.name} />
              </div>
              <div className="sa-line__end">
                <strong>{formatPrice(p.price * line.quantity)}</strong>
                <button type="button" className="sa-icon-btn sa-icon-btn--ghost" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}>
                  <TrashIcon size={16} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sa-summary">
        <div className="sa-summary__row">
          <span>Subtotal ({totals.itemCount} items)</span>
          <span>{formatPrice(totals.subtotal)}</span>
        </div>
        <div className="sa-summary__row">
          <span>Delivery</span>
          <span>{totals.shipping === 0 ? 'Free' : formatPrice(totals.shipping)}</span>
        </div>
        <div className="sa-summary__row">
          <span>Includes GST (18%)</span>
          <span>{formatPrice(totals.tax)}</span>
        </div>
        <div className="sa-summary__row sa-summary__total">
          <span>Total</span>
          <span>{formatPrice(totals.total)}</span>
        </div>
        <button type="button" className="sa-btn sa-btn--block" onClick={onCheckout}>
          <LockIcon size={16} /> Checkout · {formatPrice(totals.total)}
        </button>
      </div>
    </div>
  );
}
