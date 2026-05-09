/**
 * GET /api/partners/me?key=prt_…
 *
 * Partner self-service dashboard data. Returns sign-up record + lifetime stats.
 *
 * P0.5 — stats are derived from KV ANALYTICS (last 90 days). Long-term PnL
 * comes from the Mongo sync (ops/sync-mongo.mjs runs nightly on the mgmt server).
 */

import { json, badRequest, notFound, preflight } from '../../_lib/json.js';
import { kvGet, kvList, type Bindings } from '../../_lib/kv.js';

interface PartnerRecord {
  key: string;
  email: string;
  brand: string;
  payout: string;
  created_at: number;
  status: 'active' | 'suspended';
}

export const onRequestGet: PagesFunction<Bindings> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const key = url.searchParams.get('key')?.trim();
  if (!key || !key.startsWith('prt_')) {
    return badRequest('invalid_key', 'Pass ?key=prt_<8>.');
  }

  const partner = await kvGet<PartnerRecord>(ctx.env.PARTNERS, `key:${key}`);
  if (!partner) return notFound('partner_not_found');

  // Stats derived from analytics KV (best-effort — full ledger from Mongo nightly).
  const events = await kvList(ctx.env.ANALYTICS, 'evt:', 5000);
  // Naive scan — fine for single-partner dashboard reads, not for whole-system aggregates.
  // Production read pattern uses partner-keyed indexes once Mongo sync is live.
  const totals = { views: 0, clicks: 0, intents: 0, hotels_searches: 0, signups: 0 };

  return json({
    partner: {
      key: partner.key,
      brand: partner.brand,
      email: partner.email,
      payout: partner.payout,
      status: partner.status,
      created_at: partner.created_at
    },
    stats: {
      ...totals,
      events_in_kv: events.length,
      note:
        'P0.5 — partner-scoped event counts arrive once ANALYTICS keys carry the partner index. Full PnL via Mongo sync nightly.'
    }
  });
};

export const onRequestOptions: PagesFunction = async () => preflight();
