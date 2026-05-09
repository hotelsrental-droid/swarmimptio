/**
 * POST /api/widget/intent
 *
 * Create an Intent. Returns a stable intent_id, the canonical find-hotel-input deeplink,
 * a tracking-pixel URL, and an embed snippet.
 *
 * Body (JSON):
 *   {
 *     "destination": "Dublin",
 *     "partner": { "key": "prt_abc", "channel": "tg", "campaign": "summer-2026", "creator": "@bee" },
 *     "guests": { "adults": 2, "children": 0, "rooms": 1 } (optional),
 *     "intent": "search_hotel" (optional),
 *     "user_locale": "en-IE" (optional)
 *   }
 *
 * Response (JSON):
 *   {
 *     "intent_id": "iid_<12>",
 *     "deeplink": "https://app.impt.io/find-hotel-input?...",
 *     "track": "https://swarm.impt.io/api/widget/track?...",
 *     "embed": "<script src='...' data-key='...'></script>...",
 *     "qr": "https://swarm.impt.io/api/qr/<key>.svg?dest=Dublin"
 *   }
 */

import { findCity } from '../../../../../adapters/_shared/src/cities.js';
import { json, badRequest, preflight } from '../../_lib/json.js';
import { kvPut, type Bindings } from '../../_lib/kv.js';
import { newIntentId } from '../../_lib/keys.js';

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

export const onRequestPost: PagesFunction<Bindings> = async (ctx) => {
  let body: IntentBody;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const dest = body.destination?.trim();
  if (!dest) {
    return badRequest('destination_required', 'Pass a CITY (never country) per IMPT memory rule.');
  }

  const partner = body.partner ?? {};
  const key = partner.key || 'swarm-public';
  const channel = partner.channel || 'widget';

  const iid = newIntentId();
  const deeplink = buildDeeplink(body, iid);
  const track =
    `https://swarm.impt.io/api/widget/track?key=${encodeURIComponent(key)}` +
    `&evt=intent_created&channel=${encodeURIComponent(channel)}` +
    `&dest=${encodeURIComponent(dest)}&iid=${iid}&ts=${Date.now()}`;
  const embed = `<script src="https://swarm.impt.io/widget.js" data-key="${escapeHtml(key)}" data-dest="${escapeHtml(dest)}" async></script><div id="impt-swarm"></div>`;
  const qr = `https://swarm.impt.io/api/qr/${encodeURIComponent(key)}.svg?dest=${encodeURIComponent(dest)}&iid=${iid}`;

  // Persist intent for the conversion-attribution loop.
  const cf = (ctx.request as Request & { cf?: { country?: string } }).cf;
  const record = {
    iid,
    key,
    channel,
    destination: dest,
    campaign: partner.campaign ?? null,
    creator: partner.creator ?? null,
    click_id: partner.click_id ?? null,
    guests: body.guests ?? null,
    user_locale: body.user_locale ?? null,
    cf_country: cf?.country ?? null,
    ts: Date.now(),
    status: 'created' as const
  };
  ctx.waitUntil(kvPut(ctx.env.INTENTS, `intent:${iid}`, record, { ttlDays: 90 }));

  return json({ intent_id: iid, deeplink, track, embed, qr });
};

export const onRequestOptions: PagesFunction = async () => preflight();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
