# Shop Assistant: Embeddable AI Shopping Widget

An embeddable, voice-enabled AI shopping assistant that any website can add with **one `<script>` tag**.
Customers can chat or talk to the assistant, browse a product catalogue, manage a cart, and complete a mock checkout, all inside a floating widget.

> **Live demo:** https://dheeraj-shop-assistant.netlify.app · **One-line embed proof:** https://dheeraj-shop-assistant.netlify.app/one-line-embed.html · **Demo video:** https://drive.google.com/file/d/1TE91ZcldWE-qXX53wkCjdtagNid3aJud/view?usp=sharing

## Features

| | |
|---|---|
| 💬 **Floating chat widget** | Animated launcher with a cart badge and a greeting teaser. Opens a panel with Chat, Shop and Cart tabs |
| 🎙️ **Voice input** | Tap the mic and speak. You see a live transcript, and the message sends automatically when you stop talking (Web Speech API) |
| 🔊 **Voice response** | Replies are read aloud (speech synthesis). This turns on automatically the first time you use the mic, and can be toggled in the header. Every message also has its own replay button |
| 🤖 **AI assistant** | Understands natural requests: *"headphones under ₹15,000"*, *"gift ideas under 2000 rupees"*, *"speakers below 5k"*, *"add the second one"*, *"add 2 of them"*, *"tell me about it"*, *"remove the smartwatch"*, *"what's in my cart?"*, *"checkout"* |
| 🛍️ **Product catalogue** | 12 mock products with search, category filters, sorting and a product detail sheet |
| 🛒 **Cart** | Add from chat, catalogue, detail sheet or by voice. Quantity steppers, free-delivery progress bar, GST-inclusive totals. Saved in `localStorage` |
| 💳 **Mock purchase flow** | Indian checkout: **UPI or card**, with live validation (UPI ID, 10-digit mobile, 6-digit PIN code, Luhn card check, expiry), a simulated payment gateway, decline handling and an order confirmation |
| 📱 **Modern, responsive UI** | Light/dark/auto themes, full-screen on mobile, keyboard accessible (Esc, focus rings, ARIA), respects reduced motion |
| 🧩 **Truly embeddable** | Shadow DOM style isolation, a single JS file, configured with `data-*` attributes, plus a JavaScript API and host events |

## Quick start

**Requirements:** [Node.js](https://nodejs.org) **22.12 or newer** (the current LTS works) and npm. Check with `node --version`. Voice features need **Chrome or Edge** (Safari partially).

```bash
git clone https://github.com/dheerajsvp/shop-assistant-widget.git
cd shop-assistant-widget
npm install
npm run dev
```

Open **http://localhost:5173**. This is a demo store page with the widget embedded. Click the chat bubble in the bottom-right corner.

> 🎙️ The first time you tap the mic, the browser asks for microphone permission. Speech recognition needs `localhost` or HTTPS, and Chrome/Edge send audio to their cloud speech service, so an internet connection is required.

### All scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (demo store + widget) |
| `npm test` | Unit tests (assistant NLU, pricing, payment validation, cart reducer) |
| `npm run typecheck` | TypeScript type check |
| `npm run build` | Production build into `dist/`: `shop-assistant.js` (the widget), `index.html` (demo store) and `one-line-embed.html` (one-line proof page) |
| `npm run preview` | Serve the production build at http://localhost:4173 |

## Embedding on any website

**It really is one line.** [`one-line-embed.html`](one-line-embed.html) is a blank page whose only addition is

```html
<script src="./shop-assistant.js"></script>
```

and the full widget (chat, voice, catalogue, cart, checkout) appears on it. Open `/one-line-embed.html` on the dev server, the preview or the live demo to see it. (It can use the short `./` path because it sits next to the file.)

**To add it to any other website**, paste this line, which uses the full address of the hosted file:

```html
<script src="https://dheeraj-shop-assistant.netlify.app/shop-assistant.js"></script>
```

To host your own copy, build once (`npm run build`), upload `dist/shop-assistant.js` anywhere, and point `src` at it. Branding is optional:

```html
<script
  src="https://dheeraj-shop-assistant.netlify.app/shop-assistant.js"
  data-brand-name="My Store"
  data-assistant-name="Sage"
  data-primary-color="#0EA5E9"
  data-position="right"
  data-theme="auto"
  defer
></script>
```

| Attribute | Default | Description |
|---|---|---|
| `data-brand-name` | `Lumen & Co.` | Store name in the header |
| `data-assistant-name` | `Sage` | Assistant persona name |
| `data-primary-color` | `#6D5DF6` | Any CSS colour; the whole theme derives from it |
| `data-position` | `right` | `right` or `left` |
| `data-theme` | `auto` | `light`, `dark`, or `auto` (follows the OS) |
| `data-open-on-load` | `false` | Open the panel immediately |
| `data-show-teaser` | `true` | Show the "Need a hand?" bubble |
| `data-greeting` | (generated) | Custom first message |
| `data-auto-init` | `true` | Set to `false` to initialise manually from JS |

### JavaScript API

```js
ShopAssistant.init({ brandName: 'My Store', primaryColor: 'tomato' }); // with data-auto-init="false"
ShopAssistant.open();        // open on the current tab
ShopAssistant.open('shop');  // open straight to a tab: 'chat' | 'shop' | 'cart'
ShopAssistant.close();
ShopAssistant.toggle();
ShopAssistant.destroy();
```

### Host page events

The widget dispatches `CustomEvent`s on `window`, so the host store can sync its own cart or analytics:

```js
window.addEventListener('shopassistant:add_to_cart', (e) => console.log(e.detail)); // { productId, name, price, quantity }
window.addEventListener('shopassistant:purchase', (e) => console.log(e.detail));    // full order object
```

## Try these

| Say or type | What happens |
|---|---|
| "Show me headphones under 15000 rupees" | Product cards appear, and the reply is spoken if voice is on |
| "Add the first one" / "Add 2 of the second one" | Adds from the last results |
| "Gift ideas under ₹2,000" / "Speakers below 5k" | Top-rated picks within budget |
| "Tell me about the third one" | Product details |
| "Show similar items" / "Show cheaper options" | Alternatives |
| "What's in my cart?" / "Remove the diffuser" / "Clear my cart" | Cart management |
| "Checkout" / "Buy now" | Opens the checkout |

**Checkout test data:** any valid UPI ID succeeds (e.g. `priya@okaxis`), and `fail@upi` is declined. Card `4242 4242 4242 4242` succeeds, and `4000 0000 0000 0002` is declined (use any future expiry and any CVV). The **Fill demo details** button fills in the form.

## Architecture

```
src/
├── embed.tsx            # Entry: Shadow DOM mount, data-* config, public JS API
├── App.tsx              # Theme variables + CartProvider
├── config.ts            # Widget options, defaults and validation
├── styles.css           # All widget styles (injected into the shadow root)
├── ai/
│   ├── assistant.ts     # Built-in keyword assistant (the always-available fallback)
│   ├── chatApi.ts       # Request/response contract + client for the AI endpoint
│   └── reply.ts         # Turns the AI endpoint's reply into widget messages
├── hooks/useSpeech.ts   # Speech recognition (STT) and speech synthesis (TTS) hooks
├── state/cart.tsx       # Cart reducer + context, persisted to localStorage
├── lib/
│   ├── pricing.ts       # INR totals, delivery fee, GST (18%, inclusive), ₹ formatting
│   ├── payment.ts       # UPI/card/phone/PIN validation, mock gateway, order creation
│   └── storage.ts       # Safe localStorage wrapper
├── data/products.ts     # Mock catalogue
└── components/          # Widget shell, Chat, Catalog, ProductDetail, Cart, Checkout, Success

server/                  # The optional AI endpoint (runs server-side, never in the browser)
├── handler.ts           # POST /api/chat: CORS, rate limiting, error mapping
├── gemini.ts            # Gemini adapter: runs the tool-calling loop under a time budget
├── tools.ts             # Provider-neutral tools: search, cart, checkout (run on the real catalogue)
├── prompt.ts            # System prompt
├── validate.ts          # Input validation + redaction of card numbers, UPI IDs, emails
└── rateLimit.ts         # Sliding-window limiter
netlify/functions/chat.mts   # Netlify Function wrapper around server/handler.ts
```

**Key decisions**

- **Shadow DOM isolation.** A widget runs on other people's sites. The demo page includes deliberately hostile global CSS (`button { text-transform: uppercase; font-family: Georgia }`), and the widget is unaffected.
- **Single IIFE bundle** (Vite library mode). The host page needs no build step and no dependencies. CSS is inlined into the JS.
- **The assistant returns actions, not side effects**: a reply is `{ text, products, actions }`, and the UI executes actions such as `ADD_TO_CART` and `CHECKOUT`. That's why both the built-in assistant and the AI endpoint plug into the same widget.
- **No backend required.** Mock data, with the cart in `localStorage` and a simulated payment gateway. The widget is complete on its own; the AI endpoint below is an optional enhancement.
- **Localised for India.** Prices are in ₹ with Indian digit grouping (₹1,29,999) and are GST-inclusive. The assistant understands "₹5,000", "5000 rupees", "rs 5000" and "5k". Voice uses Indian English (`en-IN`) recognition and an Indian voice where available. Checkout supports UPI. The engine remembers the last products shown and the product in focus, so references like "it", "the second one" and "similar items" resolve correctly.

## AI assistant (optional)

Out of the box Sage answers with the built-in keyword assistant. Add a free Gemini API key and it becomes a real LLM-powered assistant that understands natural requests ("a gift for my dad who loves running, not too pricey"), Hinglish ("mujhe sasta speaker chahiye"), comparisons and follow-ups.

```
Widget ──POST /api/chat──▶ serverless function ──▶ Gemini (tool calling)
  ▲                         • holds the API key             │ search_products, add_to_cart,
  │                         • validates + redacts input     │ remove_from_cart, view_cart,
  │                         • rate limits                   ▼ start_checkout, open_catalogue
  └── if it is slow, down or rate-limited, the widget silently falls back to the built-in assistant
```

**Set it up locally**

1. Get a free key at [aistudio.google.com](https://aistudio.google.com) → *Get API key*.
2. Copy `.env.example` to `.env` and put the key in it (`.env` is git-ignored).
3. `npm run dev`. The widget calls `/api/chat` on the same server automatically.

**On Netlify**, add `GEMINI_API_KEY` under *Site configuration → Environment variables*. The function in `netlify/functions/chat.mts` is deployed automatically. Without the key the widget just uses the built-in assistant.

**Design notes**

- **The key never reaches the browser.** The widget only knows the endpoint URL (override with `data-ai-endpoint`, or turn the AI off with `data-ai="false"`).
- **The model can only talk about real products.** Tools run on the server against the catalogue, product cards are rendered from product *ids* the widget looks up itself, and anything the model invents simply doesn't match.
- **Cart actions are validated twice**: by the tools (known ids, quantity limits) and again by the widget before it acts.
- **Payment details never reach the model.** Card numbers, CVVs, UPI IDs and emails are redacted from the conversation on the server before any model call. Checkout stays a separate screen the customer fills in directly.
- **Bounded cost and latency**: a per-visitor rate limit, capped input sizes, a hard time budget per reply (Netlify functions are cut off at about 10 s), and a circuit breaker in the widget that stops trying after two failures in a row.
- **Provider-neutral tools.** Tools are plain functions with JSON schemas in `server/tools.ts`; `server/gemini.ts` is the only Gemini-specific file, so another provider would need only its own small adapter.
- **Fast by design.** Before calling the model, the server searches the catalogue for the customer's message and passes the likely matches along, so most questions take one model call instead of two.

The free tier has rate limits and variable latency, which is exactly why the fallback exists. Don't send personal data through a free-tier key.

## Browser support

| | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Widget, catalogue, cart, checkout | ✅ | ✅ | ✅ |
| Voice responses (TTS) | ✅ | ✅ | ✅ |
| Voice input (STT) | ✅ | ✅ (partial) | ❌ Mic disabled with a tooltip; typing still works |

## Deploying the demo

`npm run build` produces a static `dist/` folder (demo page + widget).

The live demo is deployed on **Netlify**, connected to this repository: every push to `main` rebuilds and redeploys automatically, using the settings in [`netlify.toml`](netlify.toml).

- **Netlify:** import the repo (settings are read from `netlify.toml`), or drag and drop `dist/` onto https://app.netlify.com/drop
- **Vercel:** import the repo. Build command `npm run build`, output directory `dist`

## Tech stack

React 19 · TypeScript · Vite (library mode) · Vitest · Web Speech API · CSS custom properties · Netlify Functions + Gemini API (optional AI). No UI or state libraries.
