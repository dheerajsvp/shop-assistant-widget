import { useMemo, useState } from 'react';
import { CATEGORIES } from '../data/products';
import type { Category, Product } from '../types';
import { SearchIcon } from './Icons';
import { CartControl, Price, ProductTile, Rating } from './ProductBits';

type Sort = 'featured' | 'price-asc' | 'price-desc' | 'rating';

interface CatalogViewProps {
  products: Product[];
  category: Category | 'All';
  onCategoryChange: (c: Category | 'All') => void;
  onOpenProduct: (p: Product) => void;
  /** quiet = an extra unit via the counter's +, so no 'Added' toast. */
  onAdd: (p: Product, quiet: boolean) => void;
}

export function CatalogView({ products, category, onCategoryChange, onOpenProduct, onAdd }: CatalogViewProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('featured');

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = products.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      const haystack = [p.name, p.category, p.tagline, ...p.tags].join(' ').toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
    if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    if (sort === 'rating') list.sort((a, b) => b.rating - a.rating);
    return list;
  }, [products, category, query, sort]);

  return (
    <div className="sa-catalog">
      <div className="sa-catalog__toolbar">
        <label className="sa-search">
          <SearchIcon size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products"
            aria-label="Search products"
          />
        </label>
        <select className="sa-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort products">
          <option value="featured">Featured</option>
          <option value="rating">Top rated</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>

      <div className="sa-cats" role="tablist" aria-label="Categories">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            className={`sa-cat ${category === c ? 'is-active' : ''}`}
            onClick={() => onCategoryChange(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="sa-empty">
          <div className="sa-empty__emoji">🔍</div>
          <p>No products match “{query}”.</p>
          <button type="button" className="sa-link" onClick={() => { setQuery(''); onCategoryChange('All'); }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="sa-grid">
          {visible.map((p) => (
            <article
              key={p.id}
              className="sa-card"
              tabIndex={0}
              onClick={() => onOpenProduct(p)}
              onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpenProduct(p)}
              aria-label={p.name}
            >
              <div className="sa-media">
                <ProductTile product={p} />
                <CartControl product={p} onAdd={onAdd} />
              </div>
              <div className="sa-card__body">
                <h3 className="sa-card__name">{p.name}</h3>
                <Rating product={p} />
                <div className="sa-card__row">
                  <Price product={p} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
