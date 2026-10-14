/**
 * Gemini adapter: turns a chat request into a tool-calling conversation and runs it to
 * completion.
 *
 * The loop is the standard one: send the conversation, and if the model asks for tools,
 * run them, send the results back, and repeat until it answers in plain text. A deadline
 * bounds the whole thing, because serverless functions are cut off after a few seconds.
 */
import { GoogleGenAI, createPartFromFunctionResponse, type Content } from '@google/genai';
import { normalize, searchProducts } from '../src/ai/assistant';
import type { ChatRequest, ChatResponse } from '../src/ai/chatApi';
import { PRODUCTS } from '../src/data/products';
import type { Product } from '../src/types';
import { buildSystemPrompt } from './prompt';
import { TOOLS, executeTool, mentionedProductIds, summarizeActions, type ToolState } from './tools';

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Total time budget for the whole conversation turn, across all model calls. */
  deadlineMs: number;
}

const MAX_ROUNDS = 4;
const MAX_CARDS = 4;

const DECLARATIONS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: t.parameters,
}));

/** Gemini wants alternating user/model turns that start with the user. */
export function toContents(turns: ChatRequest['messages']): Content[] {
  const contents: Content[] = [];
  for (const turn of turns) {
    const role = turn.role === 'user' ? 'user' : 'model';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts = [...(last.parts ?? []), { text: turn.text }];
    else contents.push({ role, parts: [{ text: turn.text }] });
  }
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

/**
 * Look up likely matches for the latest message before calling the model, so most questions
 * can be answered in one model call instead of two (search first, then answer). Only returns
 * matches when the message actually contains something searchable.
 */
export function findCandidates(latestUserText: string): Product[] {
  const found = searchProducts(normalize(latestUserText), PRODUCTS);
  return found.hasCriteria ? found.results.slice(0, 5) : [];
}

/** The widget shows plain text, so drop any markdown the model slips in. */
const plain = (text: string) => text.replace(/[*_`#]+/g, '').replace(/\n{3,}/g, '\n\n').trim();

export async function runGemini(request: ChatRequest, options: GeminiOptions): Promise<ChatResponse> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const startedAt = Date.now();
  const state: ToolState = {
    cart: request.cart.map((line) => ({ ...line })),
    actions: [],
    addedIds: [],
  };
  const contents = toContents(request.messages);
  const systemInstruction = buildSystemPrompt({
    assistantName: request.persona?.assistantName,
    brandName: request.persona?.brandName,
    cart: request.cart,
    shown: request.shown,
    candidates: findCandidates(request.messages[request.messages.length - 1].text),
  });

  let text = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const remaining = options.deadlineMs - (Date.now() - startedAt);
    if (remaining < 1200) {
      // Out of time. If tools already changed the cart, report that instead of failing.
      if (state.actions.length > 0) break;
      throw new AiError('The AI took too long to answer.', 504);
    }

    let response;
    try {
      response = await ai.models.generateContent({
        model: options.model,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: DECLARATIONS }],
          maxOutputTokens: 600,
          temperature: 0.5,
          abortSignal: AbortSignal.timeout(remaining),
        },
      });
    } catch (err) {
      if (state.actions.length > 0) break;
      throw err;
    }

    const calls = response.functionCalls;
    if (!calls?.length) {
      text = response.text ?? '';
      break;
    }

    // Keep the model's turn exactly as returned (it carries signatures the API needs back).
    const modelTurn = response.candidates?.[0]?.content;
    if (!modelTurn) throw new AiError('The AI returned an empty turn.');
    contents.push(modelTurn);
    contents.push({
      role: 'user',
      parts: calls.map((call) =>
        createPartFromFunctionResponse(call.id ?? '', call.name ?? '', {
          output: executeTool(call.name ?? '', call.args, state),
        }),
      ),
    });
  }

  text = plain(text);
  if (!text) {
    // The tools ran but the model never wrote a closing sentence; the actions still happened.
    if (state.actions.length === 0) throw new AiError('The AI did not return an answer.');
    text = summarizeActions(state.actions);
  }

  const mentioned = mentionedProductIds(text);
  const productIds = [...new Set([...mentioned, ...state.addedIds])].slice(0, MAX_CARDS);
  const focusId = state.addedIds[state.addedIds.length - 1] ?? (mentioned.length === 1 ? mentioned[0] : undefined);

  return { text, productIds, actions: state.actions, focusId };
}
