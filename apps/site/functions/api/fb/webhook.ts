/**
 * GET + POST /api/fb/webhook
 *
 * Facebook Messenger Platform webhook. Same pattern as WhatsApp Cloud API
 * (Meta's two products share the verification flow).
 *
 * GET handles webhook verification.
 * POST handles incoming Messenger messages — text → city → reply with quick-reply
 * buttons + a CTA that deeplinks to find-hotel-input.
 *
 * SETUP (after Mike provisions the IMPT FB Page + Messenger Platform app):
 *   1. Set env: FB_PAGE_ACCESS_TOKEN (from Meta dev portal → Messenger), FB_VERIFY_TOKEN
 *   2. Meta dev portal → Messenger → Webhooks → URL = https://swarm.impt.io/api/fb/webhook
 *   3. Verify token = $FB_VERIFY_TOKEN; subscribe to: messages, messaging_postbacks
 *   4. The Page username becomes the m.me/<username> we deeplink to from /fb
 */

import { findCity } from '../../../../../adapters/_shared/src/cities.js';
import { json, preflight } from '../../_lib/json.js';
import { kvPut, type Bindings } from '../../_lib/kv.js';
import { newIntentId, newEventId } from '../../_lib/keys.js';

interface Env extends Bindings {
  FB_PAGE_ACCESS_TOKEN?: string;
  FB_VERIFY_TOKEN?: string;
  FB_PAGE_USERNAME?: string;
}

const FALLBACK_KEY = 'swarm-public';
const GRAPH = 'https://graph.facebook.com/v19.0';

interface FbMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; quick_reply?: { payload: string } };
  postback?: { title: string; payload: string };
}

interface FbWebhook {
  object: 'page';
  entry?: { id: string; time: number; messaging?: FbMessagingEvent[] }[];
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
  p.set('utm_medium', 'fb');
  p.set('utm_campaign', 'messenger');
  p.set('utm_content', 'cream');
  p.set('iid', iid);
  return `https://app.impt.io/find-hotel-input?${p.toString()}`;
}

async function fbSend(env: Env, recipientId: string, payload: object): Promise<void> {
  if (!env.FB_PAGE_ACCESS_TOKEN) return;
  await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(env.FB_PAGE_ACCESS_TOKEN)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      ...payload
    })
  });
}

async function fbReplyCityCTA(env: Env, to: string, city: string, key: string): Promise<void> {
  if (!env.FB_PAGE_ACCESS_TOKEN) return;
  const iid = newIntentId();
  const url = deeplink(iid, city, key);
  const hit = findCity(city);
  const niceCity = hit?.name ?? city;

  if (env.INTENTS) {
    await kvPut(
      env.INTENTS,
      `intent:${iid}`,
      {
        iid,
        key,
        channel: 'fb',
        destination: niceCity,
        campaign: 'messenger',
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

  // Generic template with a single URL button — Messenger's preferred CTA pattern.
  await fbSend(env, to, {
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            {
              title: `${niceCity} — find a green hotel`,
              subtitle:
                '€5 free credit · 5% Goodness back · 1 tonne CO₂ offset per booking (we pay).',
              buttons: [
                { type: 'web_url', url, title: `Find hotels in ${niceCity} →` },
                { type: 'postback', title: 'Pick another city', payload: 'RESTART' }
              ]
            }
          ]
        }
      }
    }
  });
}

async function fbReplyCityPicker(env: Env, to: string): Promise<void> {
  if (!env.FB_PAGE_ACCESS_TOKEN) return;
  const cities = ['Dublin', 'London', 'Paris', 'Barcelona', 'Rome', 'New York', 'Tokyo', 'Dubai'];
  await fbSend(env, to, {
    message: {
      text: 'Pick a city — or type one:',
      quick_replies: cities.map((c) => ({ content_type: 'text', title: c, payload: `CITY:${c}` }))
    }
  });
}

/** GET — webhook verification. */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && ctx.env.FB_VERIFY_TOKEN && token === ctx.env.FB_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
};

/** POST — Messenger updates. */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!ctx.env.FB_PAGE_ACCESS_TOKEN) {
    return json({ ok: true, note: 'fb_not_provisioned' });
  }

  let body: FbWebhook;
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
        { evt: 'fb_update', channel: 'fb', ts: Date.now() },
        { ttlDays: 90 }
      )
    );
  }

  const events = body.entry?.flatMap((e) => e.messaging ?? []) ?? [];

  for (const ev of events) {
    if (!ev) continue;
    const sender = ev.sender.id;

    // Postback (button tap)
    if (ev.postback) {
      if (ev.postback.payload === 'RESTART') {
        ctx.waitUntil(fbReplyCityPicker(ctx.env, sender));
      } else if (ev.postback.payload.startsWith('CITY:')) {
        ctx.waitUntil(fbReplyCityCTA(ctx.env, sender, ev.postback.payload.slice(5), FALLBACK_KEY));
      }
      continue;
    }

    // Quick reply
    if (ev.message?.quick_reply) {
      const p = ev.message.quick_reply.payload;
      if (p.startsWith('CITY:')) {
        ctx.waitUntil(fbReplyCityCTA(ctx.env, sender, p.slice(5), FALLBACK_KEY));
        continue;
      }
    }

    // Plain text
    const txt = (ev.message?.text ?? '').trim();
    if (!txt) {
      ctx.waitUntil(fbReplyCityPicker(ctx.env, sender));
      continue;
    }
    const cleaned = txt.replace(/^(book|find|hotel|hotels|stay)\s+/i, '').trim();
    if (cleaned) ctx.waitUntil(fbReplyCityCTA(ctx.env, sender, cleaned, FALLBACK_KEY));
    else ctx.waitUntil(fbReplyCityPicker(ctx.env, sender));
  }

  return new Response('ok');
};

export const onRequestOptions: PagesFunction = async () => preflight();
