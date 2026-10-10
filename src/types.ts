export type Category = 'Audio' | 'Wearables' | 'Home' | 'Bags' | 'Accessories';

export interface Product {
  id: string;
  name: string;
  category: Category;
  price: number;
  /** Original price, shown struck through when the product is on sale. */
  compareAt?: number;
  rating: number;
  reviews: number;
  emoji: string;
  /** Two colours for the product tile gradient. */
  colors: [string, string];
  tagline: string;
  description: string;
  features: string[];
  tags: string[];
  badge?: 'Bestseller' | 'New' | 'Sale';
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface Totals {
  itemCount: number;
  subtotal: number;
  shipping: number;
  /** GST included in the subtotal (prices are GST-inclusive). */
  tax: number;
  total: number;
}

export interface Customer {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  pin: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  emoji: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  totals: Totals;
  customer: Customer;
  /** e.g. "Card •••• 4242" or "UPI priya@okaxis". */
  paidWith: string;
  transactionId: string;
  placedAt: string;
  estimatedDelivery: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  products?: Product[];
  suggestions?: string[];
  order?: Order;
  viaVoice?: boolean;
}

export type View = 'chat' | 'shop' | 'cart' | 'checkout' | 'success';
