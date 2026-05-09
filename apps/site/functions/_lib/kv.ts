/**
 * Shared KV helpers — typed wrappers around Cloudflare KV.
 *
 * Architecture: CF Pages Functions can't speak mongodb+srv:// (no raw TCP).
 * Live writes go to KV; a nightly cron on the mgmt server (ops/sync-mongo.mjs)
 * reads via the CF API and persists to Mongo `widget_intents` / `widget_partners`.
 *
 * Namespaces (declared in wrangler.toml, created automatically on first deploy):
 *   INTENTS    — intent_id → Intent record (90 day TTL)
 *   PARTNERS   — partner_key → Partner record (no TTL)
 *   ANALYTICS  — event_id → tracking event (90 day TTL)
 */

export interface Bindings {
  INTENTS?: KVNamespace;
  PARTNERS?: KVNamespace;
  ANALYTICS?: KVNamespace;
}

/** Write-through with sane defaults. Returns false if the namespace isn't bound (dev/local). */
export async function kvPut(
  ns: KVNamespace | undefined,
  key: string,
  value: unknown,
  options: { ttlDays?: number } = {}
): Promise<boolean> {
  if (!ns) return false;
  const { ttlDays = 90 } = options;
  await ns.put(key, JSON.stringify(value), { expirationTtl: ttlDays * 24 * 60 * 60 });
  return true;
}

/** Read + parse. Returns null on miss. */
export async function kvGet<T = unknown>(ns: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!ns) return null;
  const raw = await ns.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** List keys by prefix. Useful for partner/intent enumeration. */
export async function kvList(
  ns: KVNamespace | undefined,
  prefix: string,
  limit = 1000
): Promise<{ name: string; expiration?: number }[]> {
  if (!ns) return [];
  const out: { name: string; expiration?: number }[] = [];
  let cursor: string | undefined = undefined;
  while (true) {
    const result: { keys: { name: string; expiration?: number }[]; cursor?: string; list_complete?: boolean } =
      await ns.list({ prefix, cursor, limit: Math.min(limit - out.length, 1000) });
    out.push(...result.keys);
    if (out.length >= limit) break;
    if (result.list_complete || !result.cursor) break;
    cursor = result.cursor;
  }
  return out;
}
