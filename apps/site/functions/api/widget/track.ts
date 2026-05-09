/**
 * GET /api/widget/track
 *
 * Pixel beacon for the existing widget + every per-channel landing page.
 * Wire format (locked — backwards compat with the live widget.js since v0.1.0):
 *   ?key=<partner_key>&evt=<view|click|enter|convert|reserve|pay>&dest=<city?>&channel=<slug?>&ref=<host>&iid=<intent_id?>&ts=<ms>
 *
 * Response: 1×1 transparent GIF (no JSON body — IMG src usage).
 *
 * GDPR: no PII. Key, evt, dest, ref host, ts only.
 */

interface Env {
  ANALYTICS?: KVNamespace;
  ALERT_WEBHOOK?: string;
}

const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xFF, 0xFF, 0xFF, 0x21, 0xF9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3B
]);

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const params = url.searchParams;

  const event = {
    key: (params.get('key') || 'swarm-public').slice(0, 64),
    evt: (params.get('evt') || 'view').slice(0, 32),
    channel: (params.get('channel') || '').slice(0, 32) || null,
    dest: (params.get('dest') || '').slice(0, 64) || null,
    ref: (params.get('ref') || '').slice(0, 128) || null,
    iid: (params.get('iid') || '').slice(0, 64) || null,
    ts: Number(params.get('ts')) || Date.now(),
    cf_country: (ctx.request as Request & { cf?: { country?: string } }).cf?.country ?? null
  };

  // Fire-and-forget log to KV (P0.5 — replace with Mongo write via ctx.waitUntil)
  if (ctx.env.ANALYTICS) {
    const logKey = `evt:${event.ts}:${event.key}:${crypto.randomUUID()}`;
    ctx.waitUntil(ctx.env.ANALYTICS.put(logKey, JSON.stringify(event), { expirationTtl: 60 * 60 * 24 * 90 }));
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff'
    }
  });
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '86400'
    }
  });
