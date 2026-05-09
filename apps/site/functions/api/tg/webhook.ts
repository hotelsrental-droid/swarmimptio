/**
 * POST /api/tg/webhook
 *
 * Telegram Bot webhook. Receives updates, dispatches to command handlers, sends replies.
 *
 * SETUP (one-time, after Mike connects CF Pages):
 *   curl -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/setWebhook" \
 *        -d "url=https://swarm.impt.io/api/tg/webhook" \
 *        -d "secret_token=$TG_WEBHOOK_SECRET"
 *
 * The bot is currently @Rambo_Marc2_bot (token in /home/mike/impt-management/.env).
 * Mike can rename via @BotFather → /setname → "IMPT Booking" → username "imptbookingbot"
 * (or create a fresh bot for production).
 *
 * Commands:
 *   /start [city]     → greeting + city picker (or pre-fills city if passed via deeplink)
 *   /book <city>      → same path as /start with city
 *   /city <name>      → quick search
 *   /help             → explain how it works
 *   plain text        → treated as a city name
 */

import { CITIES, findCity } from '../../../../../adapters/_shared/src/cities.js';
import { json, preflight } from '../../_lib/json.js';
import { kvPut, type Bindings } from '../../_lib/kv.js';
import { newIntentId, newEventId } from '../../_lib/keys.js';
import { tgSendMessage, tgAnswerCallback, parseCommand, type TgUpdate } from '../../_lib/telegram.js';

interface Env extends Bindings {
  TG_BOT_TOKEN?: string;
  TG_WEBHOOK_SECRET?: string;
}

const FALLBACK_KEY = 'swarm-public';

/** Builds the canonical find-hotel-input deeplink for a TG-sourced click. */
function deeplink(iid: string, city: string, key: string): string {
  const hit = findCity(city);
  const p = new URLSearchParams();
  if (hit) {
    p.set('destination', hit.name);
    p.set('locationName', hit.name);
    p.set('tl', hit.country.toLowerCase());
    p.set('gl', hit.country.toLowerCase());
  } else {
    p.set('destination', city);
  }
  p.set('utm_source', `swarm-${key}`);
  p.set('utm_medium', 'tg');
  p.set('utm_campaign', 'bot');
  p.set('utm_content', 'cream');
  p.set('iid', iid);
  return `https://app.impt.io/find-hotel-input?${p.toString()}`;
}

/** Reply with city options when user says /start or unrecognised input. */
async function replyCityPicker(
  env: Env,
  chat_id: number,
  key: string,
  greet = true
): Promise<void> {
  if (!env.TG_BOT_TOKEN) return;
  // 12 city quick-picks, 3 per row.
  const top = CITIES.slice(0, 12);
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < top.length; i += 3) {
    rows.push(top.slice(i, i + 3).map((c) => ({ text: c.name, callback_data: `c:${c.name}` })));
  }
  await tgSendMessage(env.TG_BOT_TOKEN, {
    chat_id,
    text: greet
      ? `🌱 *IMPT — book hotels with conscience*\n\n€5 free credit · 5% Goodness back · 1 tonne CO₂ offset per booking.\n\nPick a city or type one:`
      : `Pick a city or type one:`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows }
  });
}

/** Reply with a "find hotels" button that deeplinks to find-hotel-input. */
async function replyBookCTA(
  env: Env,
  chat_id: number,
  city: string,
  key: string
): Promise<void> {
  if (!env.TG_BOT_TOKEN) return;
  const iid = newIntentId();
  const url = deeplink(iid, city, key);
  const hit = findCity(city);
  const niceCity = hit?.name ?? city;
  const ccy = hit?.currency ?? 'USD';

  // Persist intent for attribution.
  if (env.INTENTS) {
    await kvPut(
      env.INTENTS,
      `intent:${iid}`,
      {
        iid,
        key,
        channel: 'tg',
        destination: niceCity,
        campaign: 'bot',
        creator: null,
        click_id: null,
        guests: { adults: 2, children: 0, rooms: 1 },
        user_locale: null,
        cf_country: null,
        ts: Date.now(),
        status: 'created'
      },
      { ttlDays: 90 }
    );
  }

  await tgSendMessage(env.TG_BOT_TOKEN, {
    chat_id,
    text: `*${niceCity}* — ${ccy} prices, free cancellation on most hotels, 1 tonne CO₂ offset per booking (we pay).\n\nTap the button to see hotels and reserve. €5 free credit applied at checkout.`,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: `🔎 Find hotels in ${niceCity} →`, url }],
        [{ text: `↩ Pick another city`, callback_data: 'restart' }]
      ]
    }
  });
}

async function replyHelp(env: Env, chat_id: number): Promise<void> {
  if (!env.TG_BOT_TOKEN) return;
  await tgSendMessage(env.TG_BOT_TOKEN, {
    chat_id,
    parse_mode: 'Markdown',
    text:
      `*How this works*\n\n` +
      `1. Pick a city (button) or type one (e.g. "Dublin")\n` +
      `2. Tap *Find hotels* — opens the IMPT booking page with your city pre-filled\n` +
      `3. Pick dates, browse hotels, reserve, pay\n\n` +
      `*What you get*\n` +
      `• €5 free credit on signup\n` +
      `• 5% Goodness back per booking (3% to a cause + 2% next-stay credit)\n` +
      `• 1 tonne CO₂ offset per booking (paid by IMPT, not deducted)\n\n` +
      `*Commands*\n/start · /book <city> · /city <name> · /help`,
    disable_web_page_preview: true
  });
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // Verify Telegram secret token if configured (defence against random POSTs).
  if (env_secret(ctx.env)) {
    const got = ctx.request.headers.get('x-telegram-bot-api-secret-token');
    if (got !== env_secret(ctx.env)) {
      return new Response('forbidden', { status: 403 });
    }
  }

  if (!ctx.env.TG_BOT_TOKEN) {
    return json({ error: 'tg_bot_token_unset', hint: 'Set TG_BOT_TOKEN in CF Pages env.' }, 503);
  }

  let update: TgUpdate;
  try {
    update = await ctx.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // Pull a partner key from message context. Default to swarm-public — adapters
  // that come in from /tg?key=… deeplinks pass the key via /start <city>:<key>.
  const key = FALLBACK_KEY;

  // Analytics event (every update — useful for usage panels)
  if (ctx.env.ANALYTICS) {
    ctx.waitUntil(
      kvPut(
        ctx.env.ANALYTICS,
        newEventId(),
        { evt: 'tg_update', key, channel: 'tg', update_id: update.update_id, ts: Date.now() },
        { ttlDays: 90 }
      )
    );
  }

  // Callback query (button tap)
  if (update.callback_query) {
    const cq = update.callback_query;
    const chat_id = cq.message?.chat.id ?? cq.from.id;
    ctx.waitUntil(tgAnswerCallback(ctx.env.TG_BOT_TOKEN, cq.id));
    const data = cq.data ?? '';
    if (data === 'restart') {
      ctx.waitUntil(replyCityPicker(ctx.env, chat_id, key, false));
    } else if (data.startsWith('c:')) {
      const city = data.slice(2);
      ctx.waitUntil(replyBookCTA(ctx.env, chat_id, city, key));
    }
    return new Response('ok');
  }

  // Message (text or command)
  const m = update.message;
  if (!m) return new Response('ok');

  const chat_id = m.chat.id;
  const text = (m.text ?? '').trim();
  const cmd = parseCommand(text);

  if (cmd) {
    if (cmd.cmd === 'start' || cmd.cmd === 'book' || cmd.cmd === 'city') {
      if (cmd.args) ctx.waitUntil(replyBookCTA(ctx.env, chat_id, cmd.args, key));
      else ctx.waitUntil(replyCityPicker(ctx.env, chat_id, key, true));
      return new Response('ok');
    }
    if (cmd.cmd === 'help') {
      ctx.waitUntil(replyHelp(ctx.env, chat_id));
      return new Response('ok');
    }
    // Unknown command
    ctx.waitUntil(replyHelp(ctx.env, chat_id));
    return new Response('ok');
  }

  // Plain text — treat as city name if it matches.
  if (text && findCity(text)) {
    ctx.waitUntil(replyBookCTA(ctx.env, chat_id, text, key));
  } else if (text) {
    // Unknown city — still pass through; app.impt.io will geocode.
    ctx.waitUntil(replyBookCTA(ctx.env, chat_id, text, key));
  } else {
    ctx.waitUntil(replyCityPicker(ctx.env, chat_id, key, true));
  }
  return new Response('ok');
};

export const onRequestOptions: PagesFunction = async () => preflight();

function env_secret(env: Env): string | undefined {
  return env.TG_WEBHOOK_SECRET;
}
