import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '../lib/pricing';
import type { Product } from '../types';
import { CheckIcon, CloseIcon } from './Icons';
import { Price, ProductTile, QtyStepper, Rating } from './ProductBits';

interface ProductDetailProps {
  product: Product;
  onClose: () => void;
  onAdd: (p: Product, qty: number) => void;
  onBuyNow: (p: Product, qty: number) => void;
}

export function ProductDetail({ product, onClose, onAdd, onBuyNow }: ProductDetailProps) {
  const [qty, setQty] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setQty(1);
    closeRef.current?.focus();
  }, [product.id]);

  return (
    <div className="sa-sheet-backdrop" onClick={onClose}>
      <div
        className="sa-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="sa-icon-btn sa-sheet__close" onClick={onClose} aria-label="Close product details">
          <CloseIcon size={18} />
        </button>
        <div className="sa-sheet__scroll">
          <ProductTile product={product} size="lg" />
          <div className="sa-sheet__content">
            <span className="sa-eyebrow">{product.category}</span>
            <h2 className="sa-sheet__title">{product.name}</h2>
            <Rating product={product} />
            <div className="sa-sheet__price">
              <Price product={product} />
              {product.compareAt && (
                <span className="sa-save">Save {formatPrice(product.compareAt - product.price)}</span>
              )}
            </div>
            <p className="sa-sheet__desc">{product.description}</p>
            <ul className="sa-features">
              {product.features.map((f) => (
                <li key={f}>
                  <CheckIcon size={14} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="sa-sheet__actions">
          <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, n))} label={product.name} />
          <button type="button" className="sa-btn sa-btn--secondary" onClick={() => onAdd(product, qty)}>
            Add to cart
          </button>
          <button type="button" className="sa-btn" onClick={() => onBuyNow(product, qty)}>
            Buy now
          </button>
        </div>
      </div>
    </div>
  );
}
