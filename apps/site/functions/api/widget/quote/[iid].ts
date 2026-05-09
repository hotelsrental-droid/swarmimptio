/**
 * GET /api/widget/quote/{iid}
 *
 * Read an Intent + return a summary that adapters can render in-channel
 * (Telegram message, WhatsApp interactive list, MCP tool response).
 *
 * For P0.5 this returns the stored intent + a deeplink. Live pricing comes in
 * the next PR once the Stripe checkout flow is in place — for now consumers
 * should fall back to the deeplink for accurate pricing.
 */

import { findCity } from '../../../../../../adapters/_shared/src/cities.js';
import { json, badRequest, notFound, preflight } from '../../../_lib/json.js';
import { kvGet, type Bindings } from '../../../_lib/kv.js';

interface IntentRecord {
  iid: string;
  key: string;
  channel: string;
  destination: string;
  campaign?: string | null;
  creator?: string | null;
  click_id?: string | null;
  guests?: { adults?: number; children?: number; rooms?: number } | null;
  user_locale?: string | null;
  cf_country?: string | null;
  ts: number;
  status: 'created' | 'reserved' | 'paid' | 'cancelled';
}

export const onRequestGet: PagesFunction<Bindings, 'iid'> = async (ctx) => {
  const iid = ctx.params.iid;
  if (typeof iid !== 'string' || !iid.startsWith('iid_')) {
    return badRequest('invalid_iid', 'Expected iid_<12 chars>.');
  }

  const record = await kvGet<IntentRecord>(ctx.env.INTENTS, `intent:${iid}`);
  if (!record) return notFound('intent_not_found');

  const cityHit = findCity(record.destination);
  const currency = cityHit?.currency ?? 'USD';

  const deeplinkParams = new URLSearchParams();
  if (cityHit) {
    deeplinkParams.set('destination', cityHit.name);
    deeplinkParams.set('locationName', cityHit.name);
    deeplinkParams.set('tl', cityHit.country.toLowerCase());
    deeplinkParams.set('gl', cityHit.country.toLowerCase());
  } else {
    deeplinkParams.set('destination', record.destination);
  }
  deeplinkParams.set('utm_source', `swarm-${record.key}`);
  deeplinkParams.set('utm_medium', record.channel);
  deeplinkParams.set('utm_campaign', record.campaign ?? 'oss');
  deeplinkParams.set('utm_content', record.creator ?? 'cream');
  deeplinkParams.set('iid', iid);
  if (record.click_id) deeplinkParams.set('click_id', record.click_id);

  return json({
    intent_id: iid,
    status: record.status,
    destination: record.destination,
    currency,
    guests: record.guests ?? { adults: 2, children: 0, rooms: 1 },
    deeplink: `https://app.impt.io/find-hotel-input?${deeplinkParams.toString()}`,
    track: `https://swarm.impt.io/api/widget/track?key=${record.key}&evt=quote_view&channel=${record.channel}&iid=${iid}&ts=${Date.now()}`,
    note: 'P0.5 — live pricing arrives in the next PR. For accurate price, follow the deeplink.'
  });
};

export const onRequestOptions: PagesFunction = async () => preflight();
