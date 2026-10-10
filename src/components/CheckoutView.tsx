import { useState, type ChangeEvent, type FormEvent } from 'react';
import { getProduct } from '../data/products';
import {
  createOrder,
  DEMO_FORM,
  digitsOnly,
  EMPTY_FORM,
  formatCardNumber,
  formatExpiry,
  formatPhone,
  mockCharge,
  validateCheckout,
  type CheckoutErrors,
  type CheckoutForm,
  type PaymentMethod,
} from '../lib/payment';
import { formatPrice } from '../lib/pricing';
import { useCart } from '../state/useCart';
import type { Order } from '../types';
import { LockIcon } from './Icons';

interface CheckoutViewProps {
  onPlaced: (order: Order) => void;
}

type Status = { kind: 'idle' } | { kind: 'processing' } | { kind: 'declined'; reason: string };

const FORMATTERS: Partial<Record<keyof CheckoutForm, (v: string) => string>> = {
  cardNumber: formatCardNumber,
  expiry: formatExpiry,
  cvc: (v) => digitsOnly(v).slice(0, 4),
  phone: formatPhone,
  pin: (v) => digitsOnly(v).slice(0, 6),
};

export function CheckoutView({ onPlaced }: CheckoutViewProps) {
  const { lines, totals } = useCart();
  const [form, setForm] = useState<CheckoutForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const apply = (next: CheckoutForm) => {
    setForm(next);
    if (touched) setErrors(validateCheckout(next));
    if (status.kind === 'declined') setStatus({ kind: 'idle' });
  };

  const update = (field: keyof CheckoutForm) => (e: ChangeEvent<HTMLInputElement>) => {
    const format = FORMATTERS[field];
    apply({ ...form, [field]: format ? format(e.target.value) : e.target.value });
  };

  const setMethod = (method: PaymentMethod) => apply({ ...form, method });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const found = validateCheckout(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setStatus({ kind: 'processing' });
    const result = await mockCharge(form, totals.total);
    if (!result.ok) {
      setStatus({ kind: 'declined', reason: result.reason });
      return;
    }
    onPlaced(createOrder({ lines, lookup: getProduct, totals, form, transactionId: result.transactionId }));
  };

  const field = (name: keyof CheckoutForm, label: string, props: Record<string, string> = {}) => (
    <label className={`sa-field ${errors[name] ? 'has-error' : ''}`}>
      <span>{label}</span>
      <input
        name={name}
        value={form[name]}
        onChange={update(name)}
        aria-invalid={!!errors[name]}
        {...props}
      />
      {errors[name] && <em role="alert">{errors[name]}</em>}
    </label>
  );

  if (status.kind === 'processing') {
    return (
      <div className="sa-processing" role="status">
        <div className="sa-spinner" />
        <h3>{form.method === 'upi' ? 'Waiting for UPI approval…' : 'Processing payment…'}</h3>
        <p className="sa-muted">
          {form.method === 'upi'
            ? `A payment request for ${formatPrice(totals.total)} was sent to ${form.upiId}. This is a simulated payment.`
            : `Securely charging ${formatPrice(totals.total)}. This is a simulated payment.`}
        </p>
      </div>
    );
  }

  return (
    <form className="sa-checkout" onSubmit={submit} noValidate>
      <div className="sa-demo-note">
        <span>
          Demo checkout. No real payment is taken. Any UPI ID works (try <code>fail@upi</code> to see a decline), or
          card <code>4242 4242 4242 4242</code> (<code>4000 0000 0000 0002</code> declines).
        </span>
        <button
          type="button"
          className="sa-link"
          onClick={() => {
            setForm({ ...DEMO_FORM, method: form.method });
            setErrors({});
          }}
        >
          Fill demo details
        </button>
      </div>

      <details className="sa-order-summary">
        <summary>
          <span>Order summary ({totals.itemCount} items)</span>
          <strong>{formatPrice(totals.total)}</strong>
        </summary>
        <ul>
          {lines.map((l) => {
            const p = getProduct(l.productId);
            return p ? (
              <li key={l.productId}>
                <span>
                  {p.emoji} {l.quantity} × {p.name}
                </span>
                <span>{formatPrice(p.price * l.quantity)}</span>
              </li>
            ) : null;
          })}
          <li className="sa-muted">
            <span>Delivery</span>
            <span>{totals.shipping === 0 ? 'Free' : formatPrice(totals.shipping)}</span>
          </li>
          <li className="sa-muted">
            <span>Includes GST (18%)</span>
            <span>{formatPrice(totals.tax)}</span>
          </li>
        </ul>
      </details>

      <fieldset>
        <legend>Contact & delivery</legend>
        {field('name', 'Full name', { autoComplete: 'name' })}
        <div className="sa-field-row">
          {field('phone', 'Mobile number', { type: 'tel', inputMode: 'numeric', autoComplete: 'tel-national', placeholder: '98765 43210' })}
          {field('email', 'Email', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
        </div>
        {field('address', 'Address (house no., street, area)', { autoComplete: 'street-address' })}
        <div className="sa-field-row">
          {field('city', 'City', { autoComplete: 'address-level2' })}
          {field('pin', 'PIN code', { inputMode: 'numeric', autoComplete: 'postal-code', placeholder: '560038' })}
        </div>
      </fieldset>

      <fieldset>
        <legend>Payment</legend>
        <div className="sa-methods" role="radiogroup" aria-label="Payment method">
          {(
            [
              ['upi', '📱', 'UPI'],
              ['card', '💳', 'Card'],
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.method === value}
              className={`sa-method ${form.method === value ? 'is-active' : ''}`}
              onClick={() => setMethod(value)}
            >
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>

        {form.method === 'upi' ? (
          field('upiId', 'UPI ID', { autoComplete: 'off', autoCapitalize: 'none', placeholder: 'yourname@okaxis' })
        ) : (
          <>
            {field('cardNumber', 'Card number', { inputMode: 'numeric', autoComplete: 'cc-number', placeholder: '1234 5678 9012 3456' })}
            <div className="sa-field-row">
              {field('expiry', 'Expiry', { inputMode: 'numeric', autoComplete: 'cc-exp', placeholder: 'MM/YY' })}
              {field('cvc', 'CVV', { inputMode: 'numeric', autoComplete: 'cc-csc', placeholder: '123' })}
            </div>
          </>
        )}
      </fieldset>

      {status.kind === 'declined' && (
        <div className="sa-alert" role="alert">
          {status.reason}
        </div>
      )}

      <button type="submit" className="sa-btn sa-btn--block" disabled={totals.itemCount === 0}>
        <LockIcon size={16} /> Pay {formatPrice(totals.total)}
      </button>
    </form>
  );
}
