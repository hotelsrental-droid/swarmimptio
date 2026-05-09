/**
 * IMPT Booking Intent — channel-agnostic JSON contract.
 *
 * Every adapter (TG, WA, IG, MCP, etc.) produces an Intent.
 * The core API fulfils it. This is the contract — never break backwards compat.
 */

/** Stable channel slugs — must match URL paths under swarm.impt.io/. */
export type Channel =
  | 'web'        // /widget.js — the original embed
  | 'tg'         // /tg
  | 'wa'         // /wa (alias /whatsapp)
  | 'fb'         // /fb
  | 'ig'         // /ig
  | 'tt'         // /tiktok
  | 'x'          // /x
  | 'li'         // /li
  | 'yt'         // /yt
  | 'pin'        // /pin
  | 'reddit'    // /reddit
  | 'discord'    // /discord
  | 'slack'      // /slack
  | 'imsg'       // /imsg
  | 'email'      // /email
  | 'sms'        // /s/<key>
  | 'qr'         // /qr
  | 'nfc'        // /nfc
  | 'wallet'     // /wallet
  | 'watch'      // /watch
  | 'wear'       // /wear
  | 'glasses'    // /glasses
  | 'vision'     // /vision
  | 'voice'      // /voice/{siri,alexa,google}
  | 'carplay'    // /carplay
  | 'auto'       // /auto
  | 'tv'         // /tv
  | 'chrome'     // /chrome
  | 'firefox'    // /firefox
  | 'wp'         // /wp
  | 'shopify'    // /shopify
  | 'mcp'        // /mcp + /api/mcp/*
  | 'gpt'        // /gpt
  | 'perplexity'; // /perplexity

export type IntentVerb =
  | 'search_hotel'
  | 'get_quote'
  | 'reserve'
  | 'pay'
  | 'cancel';

export interface IntentPartner {
  /** Short partner key — granted at /partners. Public per memory rule (5% revshare). */
  key: string;
  /** Source channel slug — populated by the adapter, never the partner. */
  channel: Channel;
  /** Free-form campaign slug — UTM-grade, lowercase-kebab. */
  campaign?: string;
  /** Optional sub-attribution for creator-tier deals. */
  creator?: string;
  /** Click identifier from upstream (gclid/fbclid/uuid). Pass straight through. */
  click_id?: string;
}

export interface IntentGuests {
  adults: number;
  children: number;
  rooms: number;
}

export interface Intent {
  /** Schema version — bump on breaking changes. */
  v: 1;
  intent: IntentVerb;
  /** Destination CITY (never country). */
  destination: string;
  /** ISO date YYYY-MM-DD — null = use site default of today+14. */
  check_in: string | null;
  /** ISO date YYYY-MM-DD — null = use site default of today+16. */
  check_out: string | null;
  guests: IntentGuests;
  /** Hint only — final currency comes from destination per memory rule. */
  currency_hint?: string | null;
  partner: IntentPartner;
  /** BCP-47, used for COPY only (not currency). */
  user_locale?: string;
  consent?: { marketing?: boolean };
}

export const DEFAULT_GUESTS: IntentGuests = { adults: 2, children: 0, rooms: 1 };

/** Build a minimal Intent — consumers extend. */
export function newIntent(input: {
  destination: string;
  partner: IntentPartner;
  intent?: IntentVerb;
  guests?: Partial<IntentGuests>;
}): Intent {
  return {
    v: 1,
    intent: input.intent ?? 'search_hotel',
    destination: input.destination,
    check_in: null,
    check_out: null,
    guests: { ...DEFAULT_GUESTS, ...input.guests },
    partner: input.partner
  };
}
