/**
 * Tracking beacon — server-side and client-side helpers.
 *
 * Server-side: used by Pages Functions and bot webhooks to record entry/click/convert events.
 * Client-side: tiny pixel helper for landing pages that aren't the main widget.
 *
 * Wire-compat with the existing /api/widget/track endpoint:
 *   ?key=<partner_key>&evt=<view|click|enter|convert>&dest=<city?>&ref=<host>&ts=<ms>
 *
 * GDPR: no PII collected. key, evt, dest, referrer host, timestamp only. See docs/PRIVACY.md.
 */

import type { Channel } from './intent.js';

export type TrackEvent = 'view' | 'click' | 'enter' | 'convert' | 'reserve' | 'pay';

const TRACK_ENDPOINT = 'https://swarm.impt.io/api/widget/track';

export interface TrackInput {
  key: string;
  evt: TrackEvent;
  channel?: Channel;
  destination?: string | null;
  /** Referrer host only — never full URL (PII risk). */
  ref?: string | null;
  /** Optional intent_id to correlate later events. */
  iid?: string;
}

/** Build the tracking URL — pure, useful from anywhere (server, client, edge). */
export function buildTrackUrl(input: TrackInput, base: string = TRACK_ENDPOINT): string {
  const p = new URLSearchParams();
  p.set('key', input.key);
  p.set('evt', input.evt);
  if (input.channel) p.set('channel', input.channel);
  if (input.destination) p.set('dest', input.destination);
  if (input.ref) p.set('ref', input.ref);
  if (input.iid) p.set('iid', input.iid);
  p.set('ts', String(Date.now()));
  return `${base}?${p.toString()}`;
}

/** Client-side pixel beacon — fire-and-forget, swallows errors. */
export function trackBrowser(input: TrackInput): void {
  if (typeof window === 'undefined') return;
  try {
    const img = new Image();
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.src = buildTrackUrl(input);
  } catch {
    // swallow — tracking must never break the page
  }
}

/** Server-side beacon — used by Pages Functions and bot webhooks. */
export async function trackServer(input: TrackInput, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher(buildTrackUrl(input), { method: 'GET', keepalive: true });
  } catch {
    // swallow
  }
}
