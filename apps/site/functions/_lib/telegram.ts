/**
 * Telegram Bot API helpers — fetch-only, no SDK.
 *
 * Uses the Bot API directly (api.telegram.org). Stateless. Every call needs the bot token.
 */

const API = 'https://api.telegram.org';

export interface TgInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface TgSendMessage {
  chat_id: number | string;
  text: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: { inline_keyboard: TgInlineKeyboardButton[][] };
  disable_web_page_preview?: boolean;
}

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean; first_name: string; username?: string; language_code?: string };
    chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; first_name?: string; username?: string };
    date: number;
    text?: string;
    entities?: { type: string; offset: number; length: number }[];
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: { chat: { id: number } };
    data?: string;
  };
}

/** Send a message — fire-and-forget if you don't need the response. */
export async function tgSendMessage(token: string, msg: TgSendMessage): Promise<Response> {
  return fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(msg)
  });
}

/** Acknowledge a callback query (stops the spinner on Telegram client). */
export async function tgAnswerCallback(token: string, callback_query_id: string, text?: string): Promise<Response> {
  return fetch(`${API}/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id, ...(text ? { text } : {}) })
  });
}

/** Parse the leading command from a message text. e.g. "/book Dublin" → { cmd: 'book', args: 'Dublin' }. */
export function parseCommand(text: string | undefined): { cmd: string; args: string } | null {
  if (!text || !text.startsWith('/')) return null;
  const space = text.indexOf(' ');
  const head = (space === -1 ? text : text.slice(0, space)).slice(1);
  // Strip @botname suffix that Telegram adds in groups.
  const cmd = head.split('@')[0]!.toLowerCase();
  const args = space === -1 ? '' : text.slice(space + 1).trim();
  return { cmd, args };
}
