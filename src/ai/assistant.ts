/**
 * Local "AI" shopping assistant.
 *
 * A small natural-language understanding pipeline that needs no backend:
 *   1. normalise the utterance (typed or transcribed from speech)
 *   2. detect the intent (greeting, search, add to cart, checkout, ...)
 *   3. extract entities: price ranges, categories, quantities, ordinals
 *      ("the second one") and pronouns ("add it") resolved against context
 *   4. rank products by keyword score (synonyms + light stemming)
 *
 * `respond` is a pure function: it returns text plus a list of actions for the
 * UI to execute. This mirrors LLM tool calling, so a real model can replace
 * this module later without changing the UI.
 */
import type { CartLine, Category, Product } from '../types';
import { computeTotals, formatPrice } from '../lib/pricing';

export type AssistantAction =
  | { type: 'ADD_TO_CART'; productId: string; quantity: number }
  | { type: 'REMOVE_FROM_CART'; productId: string }
  | { type: 'CLEAR_CART' }
  | { type: 'OPEN_CART' }
  | { type: 'OPEN_CATALOG'; category?: Category }
  | { type: 'CHECKOUT' };

export interface AssistantReply {
  text: string;
  products?: Product[];
  actions?: AssistantAction[];
  suggestions?: string[];
  /** Product the reply is about; becomes `focus` in the next turn's context. */
  focus?: Product;
}

export interface AssistantContext {
  products: Product[];
  cart: CartLine[];
  /** Products shown in the most recent reply, used to resolve "it" / "the first one". */
  lastProducts: Product[];
  /** The product the conversation is currently about (last added or described). */
  focus?: Product;
}

const MAX_RESULTS = 6;

// ---------------------------------------------------------------- vocabulary

const STOPWORDS = new Set(
  `a an the and or of for to in on at with me my mine i im ive you your we us our it its this that these those
   is are was be am do does did can could would will should please pls plz want wanna need needs looking look find
   search show give get see something some any anything thing things one ones also just really very like love maybe
   hey hi hello thanks thank ok okay yes yeah no not have has got there here what whats which who how much many
   price prices priced cost costs under below over above less more than between cheap cheaper cheapest budget
   affordable expensive dollar dollars bucks usd recommend recommendation recommendations suggest suggestion gift
   gifts idea ideas present presents popular best bestseller bestsellers seller sellers top rated trending favorite
   favourite favorites favourites nice good great cool add buy purchase take ill cart basket item items product
   products tell about details detail describe info information first second third fourth fifth last number
   option them they put into from now around under up within max min least most two three four five six seven
   eight nine ten couple pair kind sort type all every everything someone somebody him her friend dad mom mum
   similar related other others alternative alternatives rupee rupees rs inr thousand lakh`
    .split(/\s+/)
    .filter(Boolean),
);

const SYNONYMS: Record<string, string[]> = {
  earphone: ['earbud'],
  earphones: ['earbud'],
  buds: ['earbud'],
  airpods: ['earbud'],
  headset: ['headphone'],
  cans: ['headphone'],
  watch: ['smartwatch'],
  watches: ['smartwatch'],
  tracker: ['fitness'],
  light: ['lamp'],
  lights: ['lamp'],
  lighting: ['lamp'],
  bag: ['backpack'],
  bags: ['backpack'],
  rucksack: ['backpack'],
  coffee: ['mug'],
  tea: ['mug'],
  cup: ['mug'],
  glasses: ['sunglasses'],
  shades: ['sunglasses'],
  phone: ['charger'],
  music: ['audio'],
  sound: ['audio'],
  workout: ['fitness'],
  gym: ['fitness'],
  exercise: ['fitness'],
  run: ['running'],
  aroma: ['diffuser'],
  oil: ['diffuser'],
  relax: ['calm'],
  relaxing: ['calm'],
  sleep: ['sleep'],
};

const CATEGORY_WORDS: Record<string, Category> = {
  audio: 'Audio',
  wearable: 'Wearables',
  wearables: 'Wearables',
  home: 'Home',
  bags: 'Bags',
  accessory: 'Accessories',
  accessories: 'Accessories',
};

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, pair: 2,
};

const ORDINALS: Record<string, number> = {
  first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, sixth: 5, '6th': 5,
};

// ---------------------------------------------------------------- intents

const RE = {
  greeting: /^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening)|greetings)\b/,
  thanks: /\b(thanks|thank you|thx|cheers|appreciate it)\b/,
  bye: /\b(bye|goodbye|see you|that's all|thats all|that is all)\b/,
  help: /\b(help|what can you do|how does this work|what do you do|commands)\b/,
  clear: /\b(clear|empty|reset)\b.*\b(cart|basket)\b|\b(remove|delete)\b.*\b(everything|all items)\b/,
  remove: /\b(remove|delete|take out|take off|drop|get rid of)\b/,
  add: /\b(add|buy|purchase|grab|i'?ll take|i will take|get me|put)\b/,
  checkout: /\b(check ?out|place (my |the |an )?order|pay|proceed to (payment|checkout)|complete (my |the )?(order|purchase)|buy now)\b/,
  cart: /\b(cart|basket)\b|\bwhat did i (add|pick)\b/,
  openCart: /\b(open|show|view|go to|take me to|see)\b/,
  details: /\b(tell me (more )?about|more about|details?|describe|what is|what's|whats|info|information|specs?|features?)\b/,
  similar: /\b(similar|alternatives?|related|something like|anything like|other options)\b/,
  recommend: /\b(recommend|suggest|suggestion|gifts?|present|popular|best ?sell(er|ers|ing)?|top rated|trending|favou?rites?|best)\b/,
  catalog: /\b(catalog(ue)?|everything|all (the )?products|what do you (sell|have|carry)|browse|keep shopping|continue shopping|inventory|full range)\b/,
  browseAction: /\b(open|browse|go to|take me to|keep shopping|continue shopping)\b/,
  pronoun: /\b(it|that|this|them|that one|this one)\b/,
  cheap: /\b(cheap|cheaper|cheapest|budget|affordable|inexpensive|low cost)\b/,
  // Amounts like "5000", "₹5000", "rs 5000", "5k", "5 thousand", "5000 rupees" (commas are stripped in normalize).
  priceMax: /\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|within|no more than|at most)\s*(?:₹|rs|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b/,
  priceMin: /\b(?:over|above|more than|at least|min(?:imum)?|starting at)\s*(?:₹|rs|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b/,
  priceRange:
    /\bbetween\s*(?:₹|rs|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\s*(?:and|to|-)\s*(?:₹|rs|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b/,
};

const amount = (num: string, multiplier?: string) => Number(num) * (multiplier ? 1000 : 1);

// ---------------------------------------------------------------- text utils

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(?=\d)/g, '$1') // "12,999" / "1,29,999" → plain digits
    .replace(/\brs\./g, 'rs ')
    .replace(/[^a-z0-9₹.'\s-]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && /(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const splitWords = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Meaningful search tokens: stopwords and numbers removed, synonyms expanded, stemmed. */
export function keywordTokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of splitWords(text.replace(/'/g, ''))) {
    if (STOPWORDS.has(raw) || /^\d/.test(raw) || raw.length < 2) continue;
    for (const w of [raw, ...(SYNONYMS[raw] ?? [])]) out.add(stem(w));
  }
  return [...out];
}

interface IndexedProduct {
  name: Set<string>;
  tags: Set<string>;
  category: string;
  description: Set<string>;
}

const indexCache = new WeakMap<Product, IndexedProduct>();

function indexOf(p: Product): IndexedProduct {
  let idx = indexCache.get(p);
  if (!idx) {
    idx = {
      name: new Set(splitWords(p.name).map(stem)),
      tags: new Set(p.tags.flatMap(splitWords).map(stem)),
      category: stem(p.category.toLowerCase()),
      description: new Set(splitWords(`${p.tagline} ${p.description}`).map(stem)),
    };
    indexCache.set(p, idx);
  }
  return idx;
}

export function scoreProduct(p: Product, tokens: string[]): number {
  const idx = indexOf(p);
  let score = 0;
  for (const t of tokens) {
    if (idx.name.has(t)) score += 3;
    else if (idx.tags.has(t)) score += 2;
    else if (idx.category === t) score += 2;
    else if (idx.description.has(t)) score += 1;
  }
  return score;
}

// ---------------------------------------------------------------- entity extraction

export interface PriceFilter {
  min?: number;
  max?: number;
}

export function parsePrice(text: string): PriceFilter {
  const range = RE.priceRange.exec(text);
  if (range) {
    const [a, b] = [amount(range[1], range[2]), amount(range[3], range[4])];
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const filter: PriceFilter = {};
  const max = RE.priceMax.exec(text);
  const min = RE.priceMin.exec(text);
  if (max) filter.max = amount(max[1], max[2]);
  if (min) filter.min = amount(min[1], min[2]);
  return filter;
}

export function parseCategory(text: string): Category | undefined {
  for (const word of splitWords(text)) {
    if (CATEGORY_WORDS[word]) return CATEGORY_WORDS[word];
  }
  return undefined;
}

export function parseQuantity(text: string): number {
  const cleaned = text
    .replace(RE.priceRange, ' ')
    .replace(RE.priceMax, ' ')
    .replace(RE.priceMin, ' ')
    .replace(/(₹|\brs|\binr)\s*\d+(\.\d+)?/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(k|thousand|rupees?|rs|inr)\b/g, ' ')
    .replace(/\b(number|option|#)\s*\d+/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)\b/g, ' ');
  const digit = /\b(\d{1,2})\b/.exec(cleaned);
  if (digit) return clampQty(Number(digit[1]));
  for (const word of splitWords(cleaned)) {
    if (NUMBER_WORDS[word]) return NUMBER_WORDS[word];
  }
  return 1;
}

const clampQty = (n: number) => Math.min(10, Math.max(1, Math.round(n)));

export function parseOrdinal(text: string, listLength: number): number | undefined {
  if (listLength === 0) return undefined;
  const numbered = /\b(?:number|option|#)\s*(\d+)/.exec(text);
  if (numbered) {
    const i = Number(numbered[1]) - 1;
    return i >= 0 && i < listLength ? i : undefined;
  }
  if (/\b(last|final)\b/.test(text) && /\b(one|item|product|option)\b/.test(text)) return listLength - 1;
  for (const word of text.split(/\s+/)) {
    const i = ORDINALS[word];
    if (i !== undefined && i < listLength) return i;
  }
  return undefined;
}

type Resolution = { kind: 'found'; product: Product } | { kind: 'ambiguous' } | { kind: 'none' };

/** Work out which product the user means, using ordinals, keywords or pronouns. */
export function resolveProduct(text: string, ctx: AssistantContext, pool = ctx.products): Resolution {
  const ordinal = parseOrdinal(text, ctx.lastProducts.length);
  if (ordinal !== undefined) {
    const product = ctx.lastProducts[ordinal];
    if (pool.includes(product)) return { kind: 'found', product };
  }

  const tokens = keywordTokens(text);
  if (tokens.length) {
    const ranked = rank(pool, tokens, ctx.lastProducts);
    if (ranked.length) return { kind: 'found', product: ranked[0] };
  }

  if (RE.pronoun.test(text)) {
    const candidates = ctx.lastProducts.filter((p) => pool.includes(p));
    if (candidates.length === 1) return { kind: 'found', product: candidates[0] };
    if (ctx.focus && pool.includes(ctx.focus)) return { kind: 'found', product: ctx.focus };
    if (candidates.length > 1) return { kind: 'ambiguous' };
  }
  return { kind: 'none' };
}

/** Products scoring >= 2, best first. Recently shown products win ties. */
function rank(products: Product[], tokens: string[], recent: Product[] = []): Product[] {
  return products
    .map((p) => ({ p, score: scoreProduct(p, tokens) + (recent.includes(p) ? 0.5 : 0) }))
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating)
    .map((r) => r.p);
}

export interface SearchOutcome {
  results: Product[];
  hasCriteria: boolean;
  category?: Category;
  price: PriceFilter;
  cheapFirst: boolean;
}

export function searchProducts(text: string, products: Product[]): SearchOutcome {
  const price = parsePrice(text);
  const category = parseCategory(text);
  const cheapFirst = RE.cheap.test(text);
  const tokens = keywordTokens(text).filter((t) => !category || stem(t) !== stem(category.toLowerCase()));

  let pool = products.filter(
    (p) =>
      (!category || p.category === category) &&
      (price.min === undefined || p.price >= price.min) &&
      (price.max === undefined || p.price <= price.max),
  );
  pool = tokens.length ? rank(pool, tokens) : [...pool].sort((a, b) => b.rating - a.rating);
  if (cheapFirst) pool.sort((a, b) => a.price - b.price);

  const hasCriteria =
    tokens.length > 0 || !!category || price.min !== undefined || price.max !== undefined || cheapFirst;
  return { results: pool.slice(0, MAX_RESULTS), hasCriteria, category, price, cheapFirst };
}

// ---------------------------------------------------------------- reply helpers

const DEFAULT_SUGGESTIONS = ['Show bestsellers', 'Headphones under ₹15,000', 'Gift ideas under ₹2,000'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeFilters(o: Pick<SearchOutcome, 'category' | 'price'>): string {
  const parts: string[] = [];
  if (o.category) parts.push(`in ${o.category}`);
  if (o.price.min !== undefined && o.price.max !== undefined) {
    parts.push(`between ${formatPrice(o.price.min)} and ${formatPrice(o.price.max)}`);
  } else if (o.price.max !== undefined) parts.push(`under ${formatPrice(o.price.max)}`);
  else if (o.price.min !== undefined) parts.push(`over ${formatPrice(o.price.min)}`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

function cartSummary(ctx: AssistantContext): AssistantReply {
  const lookup = (id: string) => ctx.products.find((p) => p.id === id);
  const totals = computeTotals(ctx.cart, lookup);
  if (totals.itemCount === 0) {
    return { text: 'Your cart is empty right now. Want some ideas?', suggestions: DEFAULT_SUGGESTIONS };
  }
  const lines = ctx.cart
    .map((l) => {
      const p = lookup(l.productId);
      return p ? `• ${l.quantity} × ${p.name}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return {
    text: `You have ${plural(totals.itemCount, 'item')} in your cart:\n${lines}\nSubtotal: ${formatPrice(totals.subtotal)}.`,
    suggestions: ['Checkout', 'Keep shopping', 'Clear my cart'],
  };
}

// ---------------------------------------------------------------- main entry

export function respond(input: string, ctx: AssistantContext): AssistantReply {
  const text = normalize(input);
  const words = text.split(' ').filter(Boolean);
  const lookup = (id: string) => ctx.products.find((p) => p.id === id);
  const cartTotals = computeTotals(ctx.cart, lookup);

  if (!text) {
    return { text: 'Ask me about a product, or try one of these:', suggestions: DEFAULT_SUGGESTIONS };
  }

  // Small talk only when the message carries no product keywords ("hey, show me headphones" is a search).
  const smallTalk = keywordTokens(text).length === 0 && !RE.add.test(text) && !RE.cart.test(text);

  if (RE.greeting.test(text) && smallTalk && words.length <= 4) {
    return { text: 'Hi there! What are you shopping for today?', suggestions: DEFAULT_SUGGESTIONS };
  }

  if (RE.thanks.test(text) && smallTalk && words.length <= 6) {
    return { text: "You're welcome! Anything else I can help you find?", suggestions: ['Show bestsellers', 'View my cart'] };
  }

  if (RE.bye.test(text) && smallTalk && words.length <= 6) {
    return { text: "Happy shopping! I'll be right here if you need me." };
  }

  if (RE.help.test(text)) {
    return {
      text:
        'I can find products, compare prices, add items to your cart and check you out, by text or by voice. ' +
        'Try "wireless earbuds under 8000 rupees", "add the first one" or "checkout".',
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  // ---- cart management (checked before search, since "cart" appears in many phrasings)

  if (RE.clear.test(text)) {
    if (cartTotals.itemCount === 0) return { text: 'Your cart is already empty.', suggestions: DEFAULT_SUGGESTIONS };
    return { text: 'Done, I cleared your cart.', actions: [{ type: 'CLEAR_CART' }], suggestions: DEFAULT_SUGGESTIONS };
  }

  if (RE.remove.test(text)) {
    const inCart = ctx.products.filter((p) => ctx.cart.some((l) => l.productId === p.id));
    if (inCart.length === 0) return { text: "There's nothing in your cart to remove." };
    const res = resolveProduct(text, ctx, inCart);
    let product = res.kind === 'found' ? res.product : undefined;
    if (!product) {
      // A named product that isn't in the cart must not fall back to removing something else.
      const named = keywordTokens(text).length > 0 ? resolveProduct(text, ctx) : undefined;
      if (named?.kind === 'found') {
        return {
          text: `The ${named.product.name} isn't in your cart.`,
          suggestions: ['View my cart', ...inCart.slice(0, 2).map((p) => `Remove ${p.name}`)],
        };
      }
      if (inCart.length === 1) product = inCart[0];
    }
    if (!product) {
      return {
        text: 'Which item should I remove?',
        suggestions: inCart.slice(0, 3).map((p) => `Remove ${p.name}`),
      };
    }
    return {
      text: `Removed ${product.name} from your cart.`,
      actions: [{ type: 'REMOVE_FROM_CART', productId: product.id }],
      suggestions: ['View my cart', 'Keep shopping'],
    };
  }

  if (RE.add.test(text) && !/\bbuy now\b/.test(text)) {
    const res = resolveProduct(text, ctx);
    if (res.kind === 'found') {
      const qty = parseQuantity(text);
      const product = res.product;
      const newCount = cartTotals.itemCount + qty;
      const newSubtotal = cartTotals.subtotal + product.price * qty;
      const isBuy = /\b(buy|purchase)\b/.test(text);
      return {
        text:
          `Added ${qty > 1 ? `${qty} × ` : ''}${product.name} to your cart. ` +
          `You now have ${plural(newCount, 'item')} (${formatPrice(newSubtotal)}).` +
          (isBuy ? ' Say "checkout" when you\'re ready.' : ''),
        actions: [{ type: 'ADD_TO_CART', productId: product.id, quantity: qty }],
        suggestions: isBuy ? ['Checkout', 'View my cart'] : ['Checkout', 'Show similar items', 'View my cart'],
        focus: product,
      };
    }
    if (res.kind === 'ambiguous') {
      return {
        text: 'Which one would you like? You can say "the first one", "the second one", and so on.',
        products: ctx.lastProducts,
      };
    }
    // "purchase" / "buy" with no product but a full cart means they want to check out.
    if (/\b(buy|purchase)\b/.test(text) && cartTotals.itemCount > 0 && keywordTokens(text).length === 0) {
      return checkoutReply(cartTotals.itemCount, cartTotals.total);
    }
    if (keywordTokens(text).length === 0) {
      return { text: 'Sure, what would you like to add?', suggestions: DEFAULT_SUGGESTIONS };
    }
    return {
      text: "I couldn't find that product. Here's what we have in our most popular range:",
      products: [...ctx.products].sort((a, b) => b.rating - a.rating).slice(0, 4),
    };
  }

  if (RE.checkout.test(text)) {
    if (cartTotals.itemCount === 0) {
      return { text: 'Your cart is empty. Add something first. Want some ideas?', suggestions: DEFAULT_SUGGESTIONS };
    }
    return checkoutReply(cartTotals.itemCount, cartTotals.total);
  }

  if (RE.cart.test(text)) {
    const summary = cartSummary(ctx);
    if (RE.openCart.test(text) && cartTotals.itemCount > 0) summary.actions = [{ type: 'OPEN_CART' }];
    return summary;
  }

  // ---- product discovery

  if (RE.similar.test(text) && (ctx.focus || ctx.lastProducts.length > 0) && keywordTokens(text).length === 0) {
    const base = ctx.focus ?? ctx.lastProducts[0];
    const similar = ctx.products
      .filter((p) => p.id !== base.id && (p.category === base.category || p.tags.some((t) => base.tags.includes(t))))
      .sort((a, b) => Number(b.category === base.category) - Number(a.category === base.category) || b.rating - a.rating)
      .slice(0, 4);
    return { text: `Here are a few alternatives to the ${base.name}:`, products: similar };
  }

  if (RE.details.test(text)) {
    const res = resolveProduct(text, ctx);
    if (res.kind === 'found') {
      const p = res.product;
      const sale = p.compareAt ? ` (down from ${formatPrice(p.compareAt)})` : '';
      return {
        text: `${p.name}: ${p.description} It's ${formatPrice(p.price)}${sale} and rated ${p.rating} out of 5 by ${p.reviews.toLocaleString('en-IN')} customers.`,
        products: [p],
        focus: p,
        suggestions: ['Add it to my cart', 'Show similar items'],
      };
    }
  }

  if (RE.recommend.test(text)) {
    const search = searchProducts(text, ctx.products);
    const picks = search.results.length
      ? search.results.slice(0, 4)
      : [...ctx.products].sort((a, b) => b.rating - a.rating).slice(0, 4);
    const gift = /\b(gifts?|presents?)\b/.test(text);
    return {
      text: `${gift ? 'Great gift ideas' : 'Our top-rated picks'}${describeFilters(search)}. Customers love the ${picks[0].name}.`,
      products: picks,
      suggestions: ['Add the first one', 'Tell me about the second one'],
    };
  }

  if (RE.catalog.test(text)) {
    const category = parseCategory(text);
    const reply: AssistantReply = {
      text: 'We carry audio, wearables, home goods, bags and accessories. Here are some highlights:',
      products: ctx.products.slice(0, MAX_RESULTS),
      suggestions: ['Browse the catalogue', 'Show bestsellers'],
    };
    if (RE.browseAction.test(text)) {
      reply.text = category ? `Opening ${category} in the catalogue.` : 'Opening the full catalogue for you.';
      reply.products = undefined;
      reply.actions = [{ type: 'OPEN_CATALOG', category }];
      reply.suggestions = undefined;
    }
    return reply;
  }

  // "Show cheaper options" right after a result list
  if (/\b(show )?cheaper (options|ones|alternatives)\b/.test(text) && ctx.lastProducts.length) {
    const ceiling = Math.min(...ctx.lastProducts.map((p) => p.price));
    const cheaper = ctx.products.filter((p) => p.price < ceiling).sort((a, b) => b.rating - a.rating).slice(0, 4);
    if (cheaper.length) return { text: `Here are some options under ${formatPrice(ceiling)}:`, products: cheaper };
  }

  const search = searchProducts(text, ctx.products);
  if (search.hasCriteria && search.results.length > 0) {
    const n = search.results.length;
    return {
      text:
        `${n === 1 ? 'Here is 1 option' : `Here are ${n} options`}${describeFilters(search)}. ` +
        (n === 1 ? 'Say "add it" to put it in your cart.' : 'Tap Add, or say "add the first one".'),
      products: search.results,
      suggestions: n === 1 ? ['Add it to my cart', 'Tell me more about it'] : ['Add the first one', 'Show cheaper options'],
    };
  }
  if (search.hasCriteria) {
    return {
      text: `I couldn't find anything matching that${describeFilters(search)}. We carry audio, wearables, home goods, bags and accessories.`,
      suggestions: ['Show bestsellers', 'Browse the catalogue'],
    };
  }


  return {
    text: "I'm not sure I caught that. You can ask me to find products, add them to your cart or check out.",
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function checkoutReply(itemCount: number, total: number): AssistantReply {
  return {
    text: `Great! Opening secure checkout for ${plural(itemCount, 'item')}, ${formatPrice(total)} total.`,
    actions: [{ type: 'CHECKOUT' }],
  };
}
