// Netlify Function: POST /api/chat
//
// The Gemini API key lives only in this function's environment (GEMINI_API_KEY, set in the
// Netlify dashboard), never in the widget. All logic is in server/handler.ts so the same code
// also runs inside the Vite dev and preview servers.
import { handleChatRequest } from '../../server/handler';

export default async (req: Request): Promise<Response> => handleChatRequest(req, process.env);

export const config = { path: '/api/chat' };
