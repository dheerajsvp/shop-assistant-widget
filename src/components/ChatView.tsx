import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeech';
import { formatPrice } from '../lib/pricing';
import type { ChatMessage, Product } from '../types';
import { MicIcon, SendIcon, SparkleIcon, StopIcon, VolumeIcon } from './Icons';
import { CartControl, Price, ProductTile, Rating } from './ProductBits';

interface ChatViewProps {
  messages: ChatMessage[];
  typing: boolean;
  onSend: (text: string, viaVoice: boolean) => void;
  /** quiet = an extra unit via the counter's +, so no 'Added' toast. */
  onAdd: (product: Product, quiet: boolean) => void;
  onOpenProduct: (product: Product) => void;
  onSpeak: (text: string) => void;
  /** Called when the mic starts, so the widget can stop any speech (avoids the mic hearing itself). */
  onMicStart: () => void;
  canSpeak: boolean;
}

export function ChatView({ messages, typing, onSend, onAdd, onOpenProduct, onSpeak, onMicStart, canSpeak }: ChatViewProps) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const voice = useSpeechRecognition({ onFinal: (text) => onSend(text, true) });

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, typing]);

  useEffect(() => {
    // Don't pop the on-screen keyboard on phones just because the panel opened.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text, false);
    setInput('');
  };

  const toggleMic = () => {
    if (voice.listening) {
      voice.stop();
    } else {
      onMicStart();
      voice.start();
    }
  };

  const lastIndex = messages.length - 1;

  return (
    <div className="sa-chat">
      <div className="sa-chat__log" ref={listRef} role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((m, i) => (
          <div key={m.id} className={`sa-msg sa-msg--${m.role}`}>
            {m.role === 'bot' && (
              <div className="sa-msg__avatar" aria-hidden="true">
                <SparkleIcon size={14} />
              </div>
            )}
            <div className="sa-msg__body">
              <div className="sa-bubble">
                {m.text}
                {m.role === 'user' && m.viaVoice && (
                  <span className="sa-bubble__voice" title="Sent by voice">
                    <MicIcon size={11} />
                  </span>
                )}
              </div>

              {m.role === 'bot' && canSpeak && (
                <button type="button" className="sa-msg__speak" onClick={() => onSpeak(m.text)} aria-label="Read this message aloud">
                  <VolumeIcon size={13} />
                </button>
              )}

              {m.products && m.products.length > 0 && (
                <div className="sa-carousel" role="list">
                  {m.products.map((p, idx) => (
                    <div
                      key={p.id}
                      role="listitem"
                      className="sa-mini"
                      tabIndex={0}
                      onClick={() => onOpenProduct(p)}
                      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpenProduct(p)}
                    >
                      {m.products!.length > 1 && <span className="sa-mini__index">{idx + 1}</span>}
                      <div className="sa-media">
                        <ProductTile product={p} size="sm" />
                        <CartControl product={p} onAdd={onAdd} />
                      </div>
                      <div className="sa-mini__info">
                        <div className="sa-mini__name">{p.name}</div>
                        <Rating product={p} />
                        <div className="sa-mini__row">
                          <Price product={p} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {m.order && (
                <div className="sa-order-mini">
                  <div className="sa-order-mini__id">{m.order.id}</div>
                  <div className="sa-muted">
                    {m.order.items.reduce((n, item) => n + item.quantity, 0)} items · {formatPrice(m.order.totals.total)}
                  </div>
                </div>
              )}

              {i === lastIndex && !typing && m.suggestions && m.suggestions.length > 0 && (
                <div className="sa-chips">
                  {m.suggestions.map((s) => (
                    <button key={s} type="button" className="sa-chip" onClick={() => onSend(s, false)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {typing && (
          <div className="sa-msg sa-msg--bot">
            <div className="sa-msg__avatar" aria-hidden="true">
              <SparkleIcon size={14} />
            </div>
            <div className="sa-bubble sa-typing" aria-label="Assistant is typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      {voice.error && (
        <div className="sa-voice-error" role="alert">
          {voice.error}
          <button type="button" onClick={voice.clearError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <form className={`sa-composer ${voice.listening ? 'is-listening' : ''}`} onSubmit={submit}>
        {voice.listening ? (
          <div className="sa-listening" aria-live="polite">
            <span className="sa-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="sa-listening__text">{voice.interim || 'Listening…'}</span>
          </div>
        ) : (
          <input
            ref={inputRef}
            className="sa-composer__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything, or tap the mic…"
            aria-label="Message"
            maxLength={300}
          />
        )}

        <button
          type="button"
          className={`sa-icon-btn sa-mic ${voice.listening ? 'is-active' : ''}`}
          onClick={toggleMic}
          disabled={!voice.supported}
          title={voice.supported ? (voice.listening ? 'Stop listening' : 'Speak') : 'Voice input needs Chrome, Edge or Safari'}
          aria-label={voice.listening ? 'Stop listening' : 'Start voice input'}
          aria-pressed={voice.listening}
        >
          {voice.listening ? <StopIcon size={18} /> : <MicIcon size={18} />}
        </button>

        {!voice.listening && (
          <button type="submit" className="sa-icon-btn sa-send" disabled={!input.trim()} aria-label="Send message">
            <SendIcon size={18} />
          </button>
        )}
      </form>
    </div>
  );
}
