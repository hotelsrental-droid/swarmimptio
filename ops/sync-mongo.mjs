#!/usr/bin/env node
/**
 * Mongo sync — runs nightly on the management server (which has direct mongodb+srv:// access).
 *
 * Why this lives outside the CF Pages app: Cloudflare Pages Functions can't speak
 * mongodb+srv:// (no raw TCP). Live writes go to KV; this cron drains KV → Mongo
 * for long-term storage and the partner PnL ledger.
 *
 * Cron (mgmt-server crontab — NOT GitHub Actions, since GHA can't reach the IMPT VPC):
 *   30 3 * * *  cd /home/mike/swarmimptio && node ops/sync-mongo.mjs >> /var/log/swarm-sync.log 2>&1
 *
 * Env (read from /home/mike/impt-management/.env or vercel-env-backup):
 *   MONGODB_URI            — IMPT cluster
 *   CLOUDFLARE_API_TOKEN   — to read KV via REST
 *   CF_ACCOUNT_ID          — Cloudflare account ID
 *   KV_INTENTS_ID          — KV namespace IDs (set after first deploy)
 *   KV_PARTNERS_ID
 *   KV_ANALYTICS_ID
 *
 * Idempotent — uses upserts keyed on iid / partner_key / event_id.
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const NS = {
  INTENTS: process.env.KV_INTENTS_ID,
  PARTNERS: process.env.KV_PARTNERS_ID,
  ANALYTICS: process.env.KV_ANALYTICS_ID
};

if (!MONGO_URI) abort('MONGODB_URI missing');
if (!CF_TOKEN || !CF_ACCOUNT) abort('CLOUDFLARE_API_TOKEN + CF_ACCOUNT_ID required');

const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db('impt');
const cIntents = db.collection('widget_intents');
const cPartners = db.collection('widget_partners');
const cEvents = db.collection('widget_events');

// Idempotent indexes — safe to call on every run.
await cIntents.createIndex({ iid: 1 }, { unique: true });
await cIntents.createIndex({ key: 1, ts: -1 });
await cPartners.createIndex({ key: 1 }, { unique: true });
await cPartners.createIndex({ email: 1 }, { unique: true });
await cEvents.createIndex({ event_id: 1 }, { unique: true });
await cEvents.createIndex({ key: 1, ts: -1 });

const totals = await Promise.all([
  drainNamespace(NS.INTENTS, 'intent:', cIntents, 'iid'),
  drainNamespace(NS.PARTNERS, 'key:', cPartners, 'key'),
  drainNamespace(NS.ANALYTICS, 'evt:', cEvents, 'event_id', { mapKeyToField: 'event_id' })
]);

console.log(`sync done: intents=${totals[0]} partners=${totals[1]} events=${totals[2]}`);
await client.close();

async function drainNamespace(nsId, prefix, collection, uniqueField, opts = {}) {
  if (!nsId) {
    console.warn(`skipping ${prefix} — namespace ID not set`);
    return 0;
  }
  let cursor = '';
  let total = 0;
  while (true) {
    const list = await cfFetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${nsId}/keys?prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${cursor}` : ''}&limit=1000`
    );
    if (!list.success) abort(`KV list failed: ${JSON.stringify(list.errors)}`);
    for (const k of list.result) {
      const value = await cfFetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(k.name)}`,
        true
      );
      if (!value) continue;
      const doc = { ...value, _kv_key: k.name, _synced_at: Date.now() };
      const filter = { [uniqueField]: doc[uniqueField] ?? k.name };
      await collection.updateOne(filter, { $set: doc }, { upsert: true });
      total++;
    }
    if (!list.result_info?.cursor) break;
    cursor = list.result_info.cursor;
  }
  return total;
}

async function cfFetch(url, raw = false) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${CF_TOKEN}` } });
  if (!r.ok) {
    if (r.status === 404 && raw) return null;
    abort(`CF API ${r.status} on ${url}`);
  }
  return raw ? r.json().catch(() => null) : r.json();
}

function abort(msg) {
  console.error(`sync-mongo: ${msg}`);
  process.exit(1);
}
