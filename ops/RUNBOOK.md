# RUNBOOK — incident playbook

> Read this first if `ops/NOTIFY_MIKE.md` exists or the uptime monitor pages.

## 1. Who can fix what

| Surface | Owner | Notes |
|---|---|---|
| `swarm.impt.io/*` (this repo) | **Claude (autonomous)** | Up to and including merge to `main` per OPS.md ramp |
| `app.impt.io/find-hotel-input` | **Henry only** | Claude NEVER touches |
| Cloudflare Pages project + DNS | Mike (one-click) | Claude can deploy via wrangler with API token, but DNS swap is Mike-eyeball |
| Stripe production keys | Mike | Claude reads from Pages env, never logs |

## 2. Most-likely incidents

### A. `/widget.js` returns non-200
Live widget is the highest-blast-radius surface — embedded on partner sites worldwide.
1. Curl `https://swarm.impt.io/widget.js` — confirm status + content-type
2. If 5xx: Cloudflare Pages dashboard → check latest deployment
3. Roll back: `wrangler pages deployment list --project-name swarm-impt` then `wrangler pages deployment promote <previous>`
4. Open `ops/NOTIFY_MIKE.md` with timestamp + symptom + rollback decision
5. Open Jules session to find root cause

### B. `/api/widget/track` returns non-200
Tracking degrades silently from the widget side (img onerror swallowed) — partner conversion data goes black-hole.
1. Curl with valid params, check status
2. Cloudflare Pages logs for the function
3. If KV write failures: check KV namespace binding in Pages env
4. Fall back: revert to legacy track endpoint (CF Worker) by removing the Pages Function

### C. A `/<channel>/index.html` 404s
Routing or build issue.
1. Confirm file exists in `apps/site/public/<channel>/index.html`
2. Confirm `npm run site:build` completes locally
3. Cloudflare Pages: check build log for the deployment

### D. Stripe webhook signature mismatch
SECURITY incident — possible replay attack or rotated keys.
1. STOP — do not auto-fix
2. Open `ops/NOTIFY_MIKE.md` immediately
3. Verify in Stripe dashboard whether legitimate keys were rotated
4. Wait for Mike before re-enabling

### E. Conversion drops > 30% on a single channel
1. Pull Clarity dashboard for that channel's URL pattern (`utm_medium=<channel>`)
2. Check find-hotel-input has not regressed (Mike will know — Henry's deploys)
3. Check the `/<channel>/index.html` deeplink builder — has `buildRedirect()` lost a UTM?
4. Open Jules session for fix; do NOT pause the channel without Mike

## 3. Halt + escalate

If any of these happen, write `ops/NOTIFY_MIKE.md` with timestamp + symptom + what was attempted, then STOP:

- Uptime breach > 15 min on `/widget.js` or `/api/widget/track`
- 3 consecutive Jules sessions fail on the same task
- Stripe webhook signature mismatch
- Cloudflare API 4xx on deploy (auth / quota issue)
- Anything that suggests a touch on `app.impt.io` is needed
- A new external service requires fresh OAuth (Meta, Apple, Stripe, etc.)

## 4. Daily / weekly digest

- `*/30 * * * *` uptime probe — alert mike@ if 5xx ≥ 2 in a row
- `0 */6 * * *` PnL join (Mongo `widget_intents.iid` ↔ Stripe charges) — write to brain
- `0 9 * * 1` weekly digest to mike@: clicks · bookings · top channels · top partners

All alerts go to **mike@impt.io only** (memory rule). Never auto-CC anyone else.

## 5. Verifying the canonical contract

Before merging any PR that changes redirect logic, manually run:

```
curl -sI "https://swarm.impt.io/api/widget/track?key=test&evt=view&ts=$(date +%s%N | cut -c1-13)"
# Expect: 200 + content-type: image/gif

curl -sX POST https://swarm.impt.io/api/widget/intent \
  -H 'content-type: application/json' \
  -d '{"destination":"Dublin","partner":{"key":"test","channel":"tg"}}'
# Expect: 200 with deeplink containing utm_source=swarm-test&utm_medium=tg
```

If either fails, do not merge.
