import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------- speech-to-text

// The Web Speech API isn't in TypeScript's DOM lib yet, so we declare the parts we use.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const MIC_MESSAGES = {
  blocked: 'Microphone access is blocked. Allow it for this site in your browser settings, then try again.',
  blockedBySystem: 'Your computer is blocking the microphone. Allow microphone access for your browser in your system privacy settings.',
  noDevice: 'No microphone was found on this device. Plug in earphones with a mic, or just type your message.',
  busy: 'Your microphone is being used by another app. Close it and try again.',
  insecure: 'Voice input only works on https:// or localhost pages. You can still type your message.',
};

const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': MIC_MESSAGES.blocked,
  'service-not-allowed': MIC_MESSAGES.blocked,
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
  'audio-capture': MIC_MESSAGES.noDevice,
  network: 'Voice recognition needs an internet connection.',
};

/**
 * Speech recognition reports a missing microphone, a denied permission and an
 * OS-level block all as "not-allowed". Asking for the mic directly returns a
 * precise error, so the user is told what to actually fix. (Listing devices
 * doesn't work: before permission is granted, browsers list a placeholder
 * microphone even when none exists.)
 */
async function explainMicError(code: string): Promise<string> {
  if (!window.isSecureContext) return MIC_MESSAGES.insecure;
  if (!navigator.mediaDevices?.getUserMedia) return RECOGNITION_ERRORS[code];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return RECOGNITION_ERRORS[code];
  } catch (err) {
    const { name, message } = err as DOMException;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return MIC_MESSAGES.noDevice;
    if (name === 'NotReadableError') return MIC_MESSAGES.busy;
    if (name === 'NotAllowedError' && /system/i.test(message)) return MIC_MESSAGES.blockedBySystem;
    return RECOGNITION_ERRORS[code];
  }
}

export function useSpeechRecognition({ onFinal, lang = 'en-IN' }: { onFinal: (text: string) => void; lang?: string }) {
  const [Ctor] = useState(getRecognitionCtor);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const start = useCallback(() => {
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = '';
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      setInterim((finalText + interimText).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        explainMicError(e.error).then(setError);
      } else {
        setError(RECOGNITION_ERRORS[e.error] ?? 'Voice input failed. Please try again.');
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      const text = finalText.trim();
      if (text) onFinalRef.current(text);
    };

    recRef.current = rec;
    setError(null);
    setInterim('');
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setError('Voice input failed to start. Please try again.');
    }
  }, [Ctor, lang]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported: !!Ctor, listening, interim, error, clearError: () => setError(null), start, stop };
}

// ---------------------------------------------------------------- text-to-speech

// Indian English voices first (Edge ships natural "Online" voices; Chrome has Google ones), then good fallbacks.
const PREFERRED_VOICES = [
  /Microsoft (Neerja|Prabhat).*Online/i,
  /Google.*India|English \(India\)/i,
  /Microsoft (Heera|Ravi)/i,
  /Microsoft (Aria|Jenny|Ava|Emma).*Online/i,
  /Google US English/i,
  /Samantha/i,
  /Microsoft Zira/i,
];

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const pattern of PREFERRED_VOICES) {
    const match = voices.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return (
    voices.find((v) => v.lang.replace('_', '-') === 'en-IN') ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  );
}

/** Make chat text pleasant to listen to: drop emoji, bullets and symbols. */
export function toSpeakable(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/•/g, '')
    .replace(/(\d+) × /g, '$1 ')
    .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, '$1 rupees')
    .replace(/[*_#]/g, '')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useSpeechSynthesis() {
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    // Chrome loads voices asynchronously, so pick again once they arrive.
    const choose = () => {
      voiceRef.current = pickVoice(synth.getVoices());
    };
    choose();
    synth.addEventListener('voiceschanged', choose);
    return () => {
      synth.removeEventListener('voiceschanged', choose);
      synth.cancel();
    };
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      const clean = toSpeakable(text);
      if (!clean) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang ?? 'en-IN';
      utterance.rate = 1.03;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
    },
    [supported],
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  return { supported, speaking, speak, cancel };
}
