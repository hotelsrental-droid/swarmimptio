/**
 * GET + POST /api/whatsapp/webhook
 *
 * WhatsApp Cloud API webhook (Meta Graph API v19+).
 *
 * GET handles webhook verification (Meta sends `hub.verify_token` + `hub.challenge`).
 * POST handles incoming messages — text → city → reply with deeplink button.
 *
 * SETUP (one-time, after Mike provisions a WA Business number in Meta dashboard):
 *   1. Set env: WA_PHONE_NUMBER_ID, WA_TOKEN, WA_VERIFY_TOKEN
 *   2. Meta dev portal → WhatsApp → Configuration → Webhook URL = https://swarm.impt.io/api/whatsapp/webhook
 *   3. Verify token = $WA_VERIFY_TOKEN; subscribe to: messages, message_status
 *   4. Add the bot phone number — that's the wa.me/<NUMBER> we deeplink to from /wa
 *
 * Meta Cloud API reference: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import { findCity } from '../../../../../adapters/_shared/src/cities.js';
import { json, preflight } from '../../_lib/json.js';
import { kvPut, type Bindings } from '../../_lib/kv.js';
import { newIntentId, newEventId } from '../../_lib/keys.js';

interface Env extends Bindings {
  WA_PHONE_NUMBER_ID?: string;
  WA_TOKEN?: string;
  WA_VERIFY_TOKEN?: string;
}

const FALLBACK_KEY = 'swarm-public';
const GRAPH = 'https://graph.facebook.com/v19.0';

interface WaTextMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text';
  text: { body: string };
}

interface WaInteractiveMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'interactive';
  interactive: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

type WaMessage = WaTextMessage | WaInteractiveMessage;

interface WaWebhookEntry {
  id: string;
  changes?: { value: { messaging_product: 'whatsapp'; messages?: WaMessage[]; metadata: { phone_number_id: string } }; field: string }[];
}

interface WaWebhook {
  object: 'whatsapp_business_account';
  entry?: WaWebhookEntry[];
}

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
  p.set('utm_medium', 'wa');
  p.set('utm_campaign', 'bot');
  p.set('utm_content', 'cream');
  p.set('iid', iid);
  return `https://app.impt.io/find-hotel-input?${p.toString()}`;
}

async function waSendText(env: Env, to: string, body: string): Promise<void> {
  if (!env.WA_PHONE_NUMBER_ID || !env.WA_TOKEN) return;
  await fetch(`${GRAPH}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.WA_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });
}

async function waSendBookCTA(env: Env, to: string, city: string, key: string): Promise<void> {
  if (!env.WA_PHONE_NUMBER_ID || !env.WA_TOKEN) return;
  const iid = newIntentId();
  const url = deeplink(iid, city, key);
  const hit = findCity(city);
  const niceCity = hit?.name ?? city;
  const ccy = hit?.currency ?? 'USD';

  if (env.INTENTS) {
    await kvPut(
      env.INTENTS,
      `intent:${iid}`,
      {
        iid,
        key,
        channel: 'wa',
        destination: niceCity,
        campaign: 'bot',
        creator: null,
        click_id: null,
        guests: null,
        user_locale: null,
        cf_country: null,
        ts: Date.now(),
        status: 'created'
      },
      { ttlDays: 90 }
    );
  }

  // WhatsApp interactive CTA URL button — single tap → web view in WA → find-hotel-input.
  await fetch(`${GRAPH}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.WA_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: {
          text: `*${niceCity}* — book a hotel in ${ccy}.\n€5 free + 5% Goodness back · 1 tonne CO₂ offset per booking (we pay).`
        },
        action: {
          name: 'cta_url',
          parameters: { display_text: `Find hotels in ${niceCity}`, url }
        }
      }
    })
  });
}

/** GET — webhook verification challenge (Meta calls this once when subscribing). */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && ctx.env.WA_VERIFY_TOKEN && token === ctx.env.WA_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
};

/** POST — incoming messages. */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!ctx.env.WA_PHONE_NUMBER_ID || !ctx.env.WA_TOKEN) {
    // Acknowledge so Meta doesn't retry-storm us, but log that we're not provisioned.
    return json({ ok: true, note: 'wa_not_provisioned' });
  }

  let body: WaWebhook;
  try {
    body = await ctx.request.json();
  } catch {
    return new Response('ok');
  }

  if (ctx.env.ANALYTICS) {
    ctx.waitUntil(
      kvPut(
        ctx.env.ANALYTICS,
        newEventId(),
        { evt: 'wa_update', channel: 'wa', ts: Date.now() },
        { ttlDays: 90 }
      )
    );
  }

  const messages = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value.messages ?? []) ?? []) ?? [];

  for (const m of messages) {
    if (!m) continue;
    const from = m.from;
    let textInput = '';
    if (m.type === 'text') textInput = m.text.body.trim();
    else if (m.type === 'interactive') {
      textInput = (m.interactive.button_reply?.title ?? m.interactive.list_reply?.title ?? '').trim();
    }

    if (!textInput) {
      ctx.waitUntil(
        waSendText(
          ctx.env,
          from,
          'Hi 👋 — type a city (e.g. "Dublin") and I\'ll send you a one-tap booking link. €5 free + 5% Goodness back.'
        )
      );
      continue;
    }

    // Strip leading verbs ("book", "find", etc.) so "book Dublin" works
    const cleaned = textInput.replace(/^(book|find|hotel|hotels|stay)\s+/i, '').trim();
    ctx.waitUntil(waSendBookCTA(ctx.env, from, cleaned, FALLBACK_KEY));
  }

  return new Response('ok');
};

export const onRequestOptions: PagesFunction = async () => preflight();
