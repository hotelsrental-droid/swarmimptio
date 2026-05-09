/**
 * POST /api/widget/intent
 *
 * Create an Intent. Returns a stable intent_id, the canonical find-hotel-input deeplink,
 * a tracking-pixel URL the adapter can fire client-side, and an embed snippet.
 *
 * Body (JSON):
 *   {
 *     "destination": "Dublin",
 *     "partner": { "key": "prt_abc", "channel": "tg", "campaign": "summer-2026", "creator": "@bee" },
 *     "guests": { "adults": 2, "children": 0, "rooms": 1 } (optional),
 *     "intent": "search_hotel" (optional, default "search_hotel"),
 *     "user_locale": "en-IE" (optional)
 *   }
 *
 * Response (JSON):
 *   {
 *     "intent_id": "iid_<22 chars>",
 *     "deeplink": "https://app.impt.io/find-hotel-input?...",
 *     "track": "https://swarm.impt.io/api/widget/track?...",
 *     "embed": "<script src='...' data-key='...'></script><div id='impt-swarm'></div>",
 *     "qr": "https://swarm.impt.io/api/qr/<key>.svg?dest=Dublin"
 *   }
 */

import { findCity } from '../../../../../adapters/_shared/src/cities.js';

interface IntentBody {
  destination?: string;
  partner?: {
    key?: string;
    channel?: string;
    campaign?: string;
    creator?: string;
    click_id?: string;
  };
  guests?: { adults?: number; children?: number; rooms?: number };
  intent?: string;
  user_locale?: string;
  consent?: { marketing?: boolean };
}

interface Env {
  INTENTS?: KVNamespace;
}

function newIntentId(): string {
  // Short, URL-safe — base32 of 12 random bytes.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let out = 'iid_';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i]! & 31];
  return out;
}

function buildDeeplink(body: IntentBody, iid: string): string {
  const partner = body.partner ?? {};
  const key = partner.key || 'swarm-public';
  const channel = partner.channel || 'widget';
  const params = new URLSearchParams();

  const dest = body.destination?.trim();
  if (dest) {
    const hit = findCity(dest);
    if (hit) {
      params.set('destination', hit.name);
      params.set('locationName', hit.name);
      params.set('tl', hit.country.toLowerCase());
      params.set('gl', hit.country.toLowerCase());
    } else {
      params.set('destination', dest);
    }
  }
  params.set('utm_source', `swarm-${key}`);
  params.set('utm_medium', channel);
  params.set('utm_campaign', partner.campaign ?? 'oss');
  params.set('utm_content', partner.creator ?? 'cream');
  params.set('iid', iid);
  if (partner.click_id) params.set('click_id', partner.click_id);

  return `https://app.impt.io/find-hotel-input?${params.toString()}`;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: IntentBody;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const key = body.partner?.key || 'swarm-public';
  const channel = body.partner?.channel || 'widget';
  const dest = body.destination?.trim();

  if (!dest) return json({ error: 'destination_required', hint: 'Pass a CITY name (never country) per IMPT memory rule.' }, 400);

  const iid = newIntentId();
  const deeplink = buildDeeplink(body, iid);
  const track = `https://swarm.impt.io/api/widget/track?key=${encodeURIComponent(key)}&evt=intent_created&channel=${encodeURIComponent(channel)}&dest=${encodeURIComponent(dest)}&iid=${iid}&ts=${Date.now()}`;
  const embed = `<script src="https://swarm.impt.io/widget.js" data-key="${escapeHtml(key)}" data-dest="${escapeHtml(dest)}" async></script><div id="impt-swarm"></div>`;
  const qr = `https://swarm.impt.io/api/qr/${encodeURIComponent(key)}.svg?dest=${encodeURIComponent(dest)}&iid=${iid}`;

  if (ctx.env.INTENTS) {
    ctx.waitUntil(ctx.env.INTENTS.put(`intent:${iid}`, JSON.stringify({ ...body, iid, ts: Date.now() }), {
      expirationTtl: 60 * 60 * 24 * 90
    }));
  }

  return json({ intent_id: iid, deeplink, track, embed, qr }, 200);
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400'
    }
  });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*'
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
