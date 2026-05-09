/**
 * Canonical redirect URL builder.
 *
 * Mike's hard rule (memory): every booking CTA across every IMPT-network surface lands on
 * `app.impt.io/find-hotel-input?destination=<CITY>&locationName=<CITY>&tl=<CC>&gl=<CC>&utm_*`.
 * No dates in the URL (customer enters dates on the page). City-only, never country.
 */

import { findCity } from './cities.js';
import type { Channel, IntentPartner } from './intent.js';

const REDIRECT_BASE = 'https://app.impt.io/find-hotel-input';

export interface RedirectOpts {
  partner: Pick<IntentPartner, 'key' | 'channel'> & Partial<IntentPartner>;
  destination?: string | null;
  /** Visual theme passed to find-hotel-input (default 'cream'). */
  theme?: string;
  /** Optional intent_id to thread Mongo↔Stripe attribution. */
  iid?: string;
  /** Free-form campaign slug — defaults to 'oss' for the existing widget channel. */
  campaign?: string;
  /** Creator handle for IG/TT/YT-style attribution. */
  creator?: string;
  /** Click ID from upstream ad network (gclid/fbclid/etc). Preserved as-is. */
  click_id?: string;
}

/** Build the canonical find-hotel-input URL. Used by every adapter and Pages Function. */
export function buildRedirect(opts: RedirectOpts): string {
  const { partner, destination, theme, iid, campaign, creator, click_id } = opts;
  const params = new URLSearchParams();

  // Destination — geocoder triple per memory canon.
  const dest = destination?.trim();
  if (dest) {
    const hit = findCity(dest);
    if (hit) {
      params.set('destination', hit.name);
      params.set('locationName', hit.name);
      params.set('tl', hit.country.toLowerCase());
      params.set('gl', hit.country.toLowerCase());
    } else {
      // Unknown city — pass through so app.impt.io can geocode/fallback.
      params.set('destination', dest);
    }
  }

  // Attribution — utm_source MUST be `swarm-<KEY>` for parity with existing widget.
  params.set('utm_source', `swarm-${partner.key}`);
  params.set('utm_medium', partner.channel ?? 'widget');
  params.set('utm_campaign', campaign ?? partner.campaign ?? 'oss');
  params.set('utm_content', creator ?? partner.creator ?? theme ?? 'cream');

  if (iid) params.set('iid', iid);
  if (click_id ?? partner.click_id) params.set('click_id', click_id ?? partner.click_id ?? '');

  return `${REDIRECT_BASE}?${params.toString()}`;
}

/** Convenience for the common case: partner key + channel + city. */
export function quickRedirect(key: string, channel: Channel, destination?: string | null): string {
  return buildRedirect({ partner: { key, channel }, destination });
}
