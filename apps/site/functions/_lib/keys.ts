/**
 * Short, URL-safe IDs for partner keys and intent IDs.
 *
 * - Partner keys are public — printed on QR codes, embedded in URLs. They must
 *   be tight (< 16 chars) and unambiguous (Crockford base32 — no I/L/O/U).
 * - Intent IDs are server-generated and short-lived (90d TTL) — also Crockford.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function randomChars(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i]! & 31];
  return out;
}

/** prt_<8> — e.g. prt_3K9XFV2Q. ~10^12 keyspace, collisions vanishingly rare. */
export function newPartnerKey(): string {
  return `prt_${randomChars(8)}`;
}

/** iid_<12> — short enough for query strings, long enough for 90-day uniqueness. */
export function newIntentId(): string {
  return `iid_${randomChars(12)}`;
}

/** evt_<16> — analytics row key. Sortable-ish via timestamp prefix. */
export function newEventId(ts: number = Date.now()): string {
  return `evt:${ts}:${randomChars(8)}`;
}
