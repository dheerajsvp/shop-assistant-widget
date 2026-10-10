import { formatPrice } from '../lib/pricing';
import type { Order } from '../types';
import { CheckIcon } from './Icons';

interface SuccessViewProps {
  order: Order;
  onContinue: () => void;
  onChat: () => void;
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => i);

export function SuccessView({ order, onContinue, onChat }: SuccessViewProps) {
  const delivery = new Date(order.estimatedDelivery).toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const firstName = order.customer.name.split(' ')[0];

  return (
    <div className="sa-success">
      <div className="sa-confetti" aria-hidden="true">
        {CONFETTI.map((i) => (
          <i key={i} style={{ ['--i' as string]: i }} />
        ))}
      </div>
      <div className="sa-success__check">
        <CheckIcon size={34} strokeWidth={3} />
      </div>
      <h2>Thank you, {firstName}!</h2>
      <p className="sa-muted">
        Your order is confirmed. A receipt would be sent to <strong>{order.customer.email}</strong> (demo, so no email is sent).
      </p>

      <div className="sa-receipt">
        <div className="sa-receipt__row">
          <span>Order number</span>
          <strong>{order.id}</strong>
        </div>
        <div className="sa-receipt__row">
          <span>Estimated delivery</span>
          <strong>{delivery}</strong>
        </div>
        <div className="sa-receipt__row">
          <span>Paid with</span>
          <strong>{order.paidWith}</strong>
        </div>
        <ul className="sa-receipt__items">
          {order.items.map((item) => (
            <li key={item.productId}>
              <span>
                {item.emoji} {item.quantity} × {item.name}
              </span>
              <span>{formatPrice(item.price * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="sa-receipt__row sa-receipt__total">
          <span>Total paid</span>
          <strong>{formatPrice(order.totals.total)}</strong>
        </div>
      </div>

      <div className="sa-success__actions">
        <button type="button" className="sa-btn" onClick={onContinue}>
          Continue shopping
        </button>
        <button type="button" className="sa-btn sa-btn--secondary" onClick={onChat}>
          Back to chat
        </button>
      </div>
    </div>
  );
}
