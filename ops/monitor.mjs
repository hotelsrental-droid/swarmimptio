#!/usr/bin/env node
/**
 * Uptime probe — runs every 30 min via .github/workflows/monitor.yml.
 *
 * Probes every per-channel URL on swarm.impt.io. Expects 200. If 5xx ≥ 2 in a row,
 * writes ops/NOTIFY_MIKE.md and exits non-zero (workflow fails, GitHub emails on failure).
 *
 * Usage:
 *   node ops/monitor.mjs                   # probe live host
 *   BASE=http://localhost:8788 node ops/monitor.mjs   # probe local CF Pages dev
 */

const BASE = process.env.BASE || 'https://swarm.impt.io';
const CHANNELS = [
  '', 'tg', 'wa', 'fb', 'ig', 'tt', 'x', 'li', 'yt', 'pin', 'reddit',
  'discord', 'slack', 'imsg', 'email', 'sms', 'qr', 'nfc', 'wallet',
  'watch', 'wear', 'glasses', 'vision',
  'voice/siri', 'voice/alexa', 'voice/google',
  'carplay', 'auto', 'tv',
  'chrome', 'firefox', 'wp', 'shopify',
  'mcp', 'gpt', 'perplexity', 'partners'
];
const STATIC = ['widget.js', '_channel.css', '_channel.js'];

const failures = [];

async function probe(path) {
  const url = `${BASE}/${path}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: 'manual' });
    const ms = Date.now() - t0;
    const ok = r.status >= 200 && r.status < 400;
    console.log(`${ok ? 'OK ' : 'FAIL'}  ${r.status}  ${ms}ms  ${url}`);
    if (!ok) failures.push({ url, status: r.status, ms });
  } catch (err) {
    console.log(`ERR    ---  ----  ${url}  ${err.message}`);
    failures.push({ url, status: 0, error: err.message });
  }
}

for (const ch of CHANNELS) await probe(ch);
for (const s of STATIC) await probe(s);

if (failures.length > 0) {
  console.error(`\n${failures.length} probe failure(s):`);
  for (const f of failures) console.error('  ' + JSON.stringify(f));
  process.exit(1);
}

console.log(`\nAll ${CHANNELS.length + STATIC.length} probes green.`);
