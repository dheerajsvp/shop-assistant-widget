import { useCallback, useEffect, useRef, useState } from 'react';
import { respond, type AssistantAction, type AssistantReply } from '../ai/assistant';
import { askSage } from '../ai/chatApi';
import { toReply } from '../ai/reply';
import type { WidgetConfig } from '../config';
import { PRODUCTS, getProduct } from '../data/products';
import { useSpeechSynthesis } from '../hooks/useSpeech';
import { formatPrice } from '../lib/pricing';
import { useCart } from '../state/useCart';
import type { Category, ChatMessage, Order, Product, View } from '../types';
import { CartView } from './CartView';
import { CatalogView } from './CatalogView';
import { ChatView } from './ChatView';
import { CheckoutView } from './CheckoutView';
import { BackIcon, CartIcon, ChatIcon, CloseIcon, MuteIcon, SparkleIcon, StoreIcon, VolumeIcon } from './Icons';
import { ProductDetail } from './ProductDetail';
import { SuccessView } from './SuccessView';

/** Lets the public JS API (ShopAssistant.open() etc.) drive the React tree. */
export interface WidgetBridge {
  setOpen?: (open: boolean | ((prev: boolean) => boolean)) => void;
  navigate?: (view: 'chat' | 'shop' | 'cart') => void;
  // Calls made before React has mounted are queued here.
  pendingOpen?: boolean;
  pendingView?: 'chat' | 'shop' | 'cart';
}

const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Notify the host page so a real store could sync its own cart or analytics. */
function emit(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(`shopassistant:${name}`, { detail }));
}

export function Widget({ config, bridge }: { config: WidgetConfig; bridge: WidgetBridge }) {
  const cart = useCart();
  const tts = useSpeechSynthesis();

  const [open, setOpen] = useState(config.openOnLoad);
  const [view, setView] = useState<View>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: uid(),
      role: 'bot',
      text: config.greeting,
      suggestions: ['Show bestsellers', 'Headphones under ₹15,000', 'Gift ideas under ₹2,000'],
    },
  ]);
  const [typing, setTyping] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);
  const [catalogCategory, setCatalogCategory] = useState<Category | 'All'>('All');
  const [toast, setToast] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [teaser, setTeaser] = useState(false);

  // Refs hold values read inside timers, avoiding stale closures.
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const voiceTouched = useRef(false);
  const lastProducts = useRef<Product[]>([]);
  const focus = useRef<Product | undefined>(undefined);
  const toastTimer = useRef<number>(undefined);

  // Chat state read from async code. Messages only change through appendMessage, so the ref
  // and the rendered state never disagree.
  const messagesRef = useRef(messages);
  const cartRef = useRef(cart.lines);
  cartRef.current = cart.lines;
  const pending = useRef(0);
  const aiFailures = useRef(0);
  const aiPausedUntil = useRef(0);

  // ---- public API bridge
  useEffect(() => {
    bridge.setOpen = setOpen;
    bridge.navigate = (v) => {
      setDetail(null);
      setView(v);
    };
    if (bridge.pendingOpen !== undefined) setOpen(bridge.pendingOpen);
    if (bridge.pendingView) bridge.navigate(bridge.pendingView);
    return () => {
      bridge.setOpen = undefined;
      bridge.navigate = undefined;
    };
  }, [bridge]);

  // ---- teaser bubble: appears a moment after page load, until the widget is opened or dismissed
  const teaserDone = useRef(false);
  useEffect(() => {
    if (!config.showTeaser || open || teaserDone.current) return;
    const t = window.setTimeout(() => setTeaser(true), 2500);
    return () => window.clearTimeout(t);
  }, [config.showTeaser, open]);

  useEffect(() => {
    if (open) {
      teaserDone.current = true;
      setTeaser(false);
    }
  }, [open]);

  // ---- Escape closes the detail sheet, then the panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (detail) setDetail(null);
      else setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, detail]);

  // Stop talking when the panel closes.
  useEffect(() => {
    if (!open) tts.cancel();
  }, [open, tts.cancel]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const addToCart = useCallback(
    (product: Product, quantity = 1, quiet = false) => {
      cart.add(product.id, quantity);
      focus.current = product;
      // The quantity counter already shows extra units, so only the first add gets a toast.
      if (!quiet) showToast(`Added ${quantity > 1 ? `${quantity} × ` : ''}${product.name}`);
      emit('add_to_cart', { productId: product.id, name: product.name, price: product.price, quantity });
    },
    [cart, showToast],
  );

  const appendMessage = useCallback((message: ChatMessage) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
  }, []);

  const pushBot = useCallback(
    (reply: AssistantReply | ChatMessage) => {
      appendMessage({ id: uid(), role: 'bot', ...reply });
      if (voiceOnRef.current) tts.speak(reply.text);
    },
    [appendMessage, tts.speak],
  );

  const runActions = useCallback(
    (actions: AssistantAction[] = []) => {
      for (const action of actions) {
        switch (action.type) {
          case 'ADD_TO_CART': {
            const p = getProduct(action.productId);
            if (p) addToCart(p, action.quantity);
            break;
          }
          case 'REMOVE_FROM_CART':
            cart.remove(action.productId);
            break;
          case 'CLEAR_CART':
            cart.clear();
            break;
          case 'OPEN_CART':
            window.setTimeout(() => setView('cart'), 900);
            break;
          case 'OPEN_CATALOG':
            setCatalogCategory(action.category ?? 'All');
            window.setTimeout(() => setView('shop'), 700);
            break;
          case 'CHECKOUT':
            window.setTimeout(() => setView('checkout'), 1100);
            break;
        }
      }
    },
    [addToCart, cart],
  );

  /**
   * Get Sage's reply: ask the AI endpoint first, and if it is slow, down, rate-limited or not
   * set up, answer with the built-in keyword assistant instead. The customer never sees an error.
   */
  const getReply = useCallback(
    async (text: string, history: ChatMessage[]): Promise<{ reply: AssistantReply; viaAi: boolean }> => {
      if (config.aiEndpoint && Date.now() >= aiPausedUntil.current) {
        try {
          const ai = await askSage(config.aiEndpoint, {
            messages: history.slice(-11).map((m) => ({ role: m.role, text: m.text })),
            cart: cartRef.current,
            shown: lastProducts.current.map((p) => p.id),
            persona: { assistantName: config.assistantName, brandName: config.brandName },
          });
          aiFailures.current = 0;
          return { reply: toReply(ai), viaAi: true };
        } catch {
          // After two failures in a row, stop trying for a minute so visitors aren't kept waiting.
          if (++aiFailures.current >= 2) aiPausedUntil.current = Date.now() + 60_000;
        }
      }
      const reply = respond(text, {
        products: PRODUCTS,
        cart: cartRef.current,
        lastProducts: lastProducts.current,
        focus: focus.current,
      });
      return { reply, viaAi: false };
    },
    [config.aiEndpoint, config.assistantName, config.brandName],
  );

  const sendMessage = useCallback(
    (text: string, viaVoice: boolean) => {
      // One question at a time; the chat disables sending while Sage is answering.
      if (pending.current > 0) return;
      // First use of the mic switches spoken replies on, unless the user has set it themselves.
      if (viaVoice && !voiceTouched.current && tts.supported) {
        voiceTouched.current = true;
        voiceOnRef.current = true;
        setVoiceOn(true);
      }
      tts.cancel();
      appendMessage({ id: uid(), role: 'user', text, viaVoice });
      pending.current = 1;
      setTyping(true);

      void (async () => {
        const startedAt = Date.now();
        try {
          const { reply, viaAi } = await getReply(text, messagesRef.current);
          if (reply.products?.length) lastProducts.current = reply.products;
          if (reply.focus) focus.current = reply.focus;
          // The built-in assistant answers instantly, so pace it a little to feel like a conversation.
          if (!viaAi) await sleep(450 + Math.min(reply.text.length * 6, 700) - (Date.now() - startedAt));
          const { focus: _focus, actions, ...message } = reply;
          pushBot(message);
          runActions(actions);
        } finally {
          pending.current = 0;
          setTyping(false);
        }
      })();
    },
    [appendMessage, getReply, pushBot, runActions, tts],
  );

  const handleOrderPlaced = useCallback(
    (order: Order) => {
      cart.clear();
      setLastOrder(order);
      setView('success');
      emit('purchase', order);
      pushBot({
        id: uid(),
        role: 'bot',
        text: `Your order ${order.id} is confirmed! ${formatPrice(order.totals.total)} paid. It should arrive in about 4 days.`,
        order,
        suggestions: ['Show bestsellers', 'Keep shopping'],
      });
    },
    [cart, pushBot],
  );

  const toggleVoice = () => {
    voiceTouched.current = true;
    setVoiceOn((v) => {
      if (v) tts.cancel();
      return !v;
    });
  };

  const goTo = (v: View) => {
    setDetail(null);
    setView(v);
  };

  const isFlow = view === 'checkout' || view === 'success';
  const statusText = tts.speaking ? 'Speaking…' : typing ? 'Typing…' : 'Online';

  return (
    <>
      {teaser && !open && (
        <div className="sa-teaser" role="status">
          <button type="button" className="sa-teaser__body" onClick={() => setOpen(true)}>
            <strong>👋 Need a hand?</strong>
            <span>Ask {config.assistantName} to find the perfect product. You can even use your voice.</span>
          </button>
          <button
            type="button"
            className="sa-teaser__close"
            aria-label="Dismiss"
            onClick={() => {
              teaserDone.current = true;
              setTeaser(false);
            }}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <button
        type="button"
        className={`sa-launcher ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close shopping assistant' : 'Open shopping assistant'}
        aria-expanded={open}
      >
        <span className="sa-launcher__icon sa-launcher__icon--chat">
          <ChatIcon size={26} />
        </span>
        <span className="sa-launcher__icon sa-launcher__icon--close">
          <CloseIcon size={24} />
        </span>
        {cart.totals.itemCount > 0 && !open && <span className="sa-launcher__badge">{cart.totals.itemCount}</span>}
      </button>

      <section
        className={`sa-panel ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-label={`${config.brandName} shopping assistant`}
        aria-hidden={!open}
        inert={!open}
      >
        <header className="sa-header">
          {isFlow ? (
            <button type="button" className="sa-icon-btn sa-icon-btn--header" onClick={() => goTo(view === 'checkout' ? 'cart' : 'chat')} aria-label="Back">
              <BackIcon size={20} />
            </button>
          ) : (
            <div className="sa-avatar" aria-hidden="true">
              <SparkleIcon size={20} />
            </div>
          )}
          <div className="sa-header__title">
            <strong>{view === 'checkout' ? 'Secure checkout' : view === 'success' ? 'Order confirmed' : config.assistantName}</strong>
            <span>
              {isFlow ? (
                config.brandName
              ) : (
                <>
                  <i className={`sa-dot ${tts.speaking ? 'is-speaking' : ''}`} /> {statusText} · {config.brandName}
                </>
              )}
            </span>
          </div>
          {tts.supported && (
            <button
              type="button"
              className={`sa-icon-btn sa-icon-btn--header ${voiceOn ? 'is-on' : ''}`}
              onClick={toggleVoice}
              aria-pressed={voiceOn}
              aria-label={voiceOn ? 'Turn off spoken replies' : 'Turn on spoken replies'}
              title={voiceOn ? 'Spoken replies on' : 'Spoken replies off'}
            >
              {voiceOn ? <VolumeIcon size={19} /> : <MuteIcon size={19} />}
            </button>
          )}
          <button type="button" className="sa-icon-btn sa-icon-btn--header" onClick={() => setOpen(false)} aria-label="Close">
            <CloseIcon size={20} />
          </button>
        </header>

        {!isFlow && (
          <nav className="sa-tabs" aria-label="Widget sections">
            <button type="button" className={view === 'chat' ? 'is-active' : ''} onClick={() => goTo('chat')} aria-current={view === 'chat'}>
              <ChatIcon size={16} /> Chat
            </button>
            <button type="button" className={view === 'shop' ? 'is-active' : ''} onClick={() => goTo('shop')} aria-current={view === 'shop'}>
              <StoreIcon size={16} /> Shop
            </button>
            <button type="button" className={view === 'cart' ? 'is-active' : ''} onClick={() => goTo('cart')} aria-current={view === 'cart'}>
              <CartIcon size={16} /> Cart
              {cart.totals.itemCount > 0 && <span className="sa-tabs__badge">{cart.totals.itemCount}</span>}
            </button>
          </nav>
        )}

        <div className="sa-body">
          {view === 'chat' && (
            <ChatView
              messages={messages}
              typing={typing}
              onSend={sendMessage}
              onAdd={(p, quiet) => addToCart(p, 1, quiet)}
              onOpenProduct={setDetail}
              onSpeak={tts.speak}
              onMicStart={tts.cancel}
              canSpeak={tts.supported}
            />
          )}
          {view === 'shop' && (
            <CatalogView
              products={PRODUCTS}
              category={catalogCategory}
              onCategoryChange={setCatalogCategory}
              onOpenProduct={setDetail}
              onAdd={(p, quiet) => addToCart(p, 1, quiet)}
            />
          )}
          {view === 'cart' && <CartView onCheckout={() => goTo('checkout')} onBrowse={() => goTo('shop')} onOpenProduct={setDetail} />}
          {view === 'checkout' && <CheckoutView onPlaced={handleOrderPlaced} />}
          {view === 'success' && lastOrder && (
            <SuccessView order={lastOrder} onContinue={() => goTo('shop')} onChat={() => goTo('chat')} />
          )}
        </div>

        {detail && (
          <ProductDetail
            product={detail}
            onClose={() => setDetail(null)}
            onAdd={(p, qty) => {
              addToCart(p, qty);
              setDetail(null);
            }}
            onBuyNow={(p, qty) => {
              addToCart(p, qty);
              goTo('checkout');
            }}
          />
        )}

        {toast && (
          <div className="sa-toast" role="status">
            <CartIcon size={15} /> {toast}
          </div>
        )}
      </section>
    </>
  );
}
