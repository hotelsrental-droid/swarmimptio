/**
 * GET /api/widget/hotels
 *
 * Channel-agnostic hotel search. Proxies the IMPT marketplace
 * platform.impt.io/api/hotels endpoint with edge caching + key-aware tracking.
 *
 * Used by every NON-WEB channel (Telegram bot, MCP, Custom GPT, etc.) where the
 * adapter needs a structured JSON list of hotels rather than a redirect.
 *
 * Query params:
 *   city            CITY name (required) — auto-resolves to lat/lng via shared cities
 *   key             Partner key (default 'swarm-public')
 *   channel         Channel slug (default 'widget')
 *   adults          Default 2
 *   rooms           Default 1
 *   currency        Default = destination-driven (per memory rule)
 *   checkIn / checkOut  Default = today+14 / today+16
 *   limit           Default 10, max 30
 *
 * Response:
 *   { city, count, hotels: [...], cached: boolean }
 */

import { findCity } from '../../../../../adapters/_shared/src/cities.js';
import { json, badRequest, preflight } from '../../_lib/json.js';
import { kvPut, type Bindings } from '../../_lib/kv.js';
import { newEventId } from '../../_lib/keys.js';

const UPSTREAM = 'https://platform.impt.io/api/hotels';
const DEFAULT_CHECKIN_OFFSET = 14;
const DEFAULT_CHECKOUT_OFFSET = 16;

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n | 0));
}

export const onRequestGet: PagesFunction<Bindings> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const city = url.searchParams.get('city')?.trim();
  if (!city) return badRequest('city_required', 'Pass ?city=Dublin (CITY name, never country).');

  const cityHit = findCity(city);
  if (!cityHit) {
    return badRequest('unknown_city', `City "${city}" not in the static list. Add to adapters/_shared/src/cities.ts.`);
  }

  const key = (url.searchParams.get('key') || 'swarm-public').slice(0, 64);
  const channel = (url.searchParams.get('channel') || 'widget').slice(0, 32);
  const adults = clamp(Number(url.searchParams.get('adults')) || 2, 1, 8);
  const rooms = clamp(Number(url.searchParams.get('rooms')) || 1, 1, 4);
  const limit = clamp(Number(url.searchParams.get('limit')) || 10, 1, 30);
  const checkIn = url.searchParams.get('checkIn') || isoDay(DEFAULT_CHECKIN_OFFSET);
  const checkOut = url.searchParams.get('checkOut') || isoDay(DEFAULT_CHECKOUT_OFFSET);
  const currency = url.searchParams.get('currency') || cityHit.currency;

  // Edge cache key — same {city,dates,guests,currency} hits the cache.
  const cacheKey = new Request(
    `https://swarm-cache.impt.io/hotels?city=${encodeURIComponent(cityHit.name)}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&rooms=${rooms}&currency=${currency}&limit=${limit}`,
    { method: 'GET' }
  );
  const cache = (caches as unknown as { default: Cache }).default;

  let cached = false;
  let response = await cache.match(cacheKey);
  if (!response) {
    const upstream = new URL(UPSTREAM);
    upstream.searchParams.set('lat', String(cityHit.lat));
    upstream.searchParams.set('lng', String(cityHit.lon));
    upstream.searchParams.set('checkIn', checkIn);
    upstream.searchParams.set('checkOut', checkOut);
    upstream.searchParams.set('adults', String(adults));
    upstream.searchParams.set('rooms', String(rooms));
    upstream.searchParams.set('currency', currency);
    upstream.searchParams.set('page', '1');

    const r = await fetch(upstream.toString(), {
      headers: {
        accept: 'application/json',
        // Pass key + channel as headers so platform.impt.io logs see who's searching, not just IP.
        'x-swarm-key': key,
        'x-swarm-channel': channel
      }
    });

    if (!r.ok) {
      return json(
        { error: 'upstream_error', upstream_status: r.status, hint: 'platform.impt.io/api/hotels failed' },
        502
      );
    }

    const data = (await r.json().catch(() => null)) as { data?: unknown[] } | null;
    const hotels = Array.isArray(data?.data) ? data!.data!.slice(0, limit) : [];
    response = json({ city: cityHit.name, count: hotels.length, hotels, cached: false });
    response.headers.set('cache-control', 'public, max-age=300, s-maxage=300');
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  } else {
    cached = true;
    const body = await response.json().catch(() => ({}));
    response = json({ ...(body as object), cached: true });
  }

  if (ctx.env.ANALYTICS) {
    ctx.waitUntil(
      kvPut(
        ctx.env.ANALYTICS,
        newEventId(),
        { evt: 'hotels_search', key, channel, city: cityHit.name, cached, ts: Date.now() },
        { ttlDays: 90 }
      )
    );
  }

  return response;
};

export const onRequestOptions: PagesFunction = async () => preflight();
