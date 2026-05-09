# STATE — Claude session ledger
> Format: append-only. Top entry is most recent. Every Claude session that touches this repo updates this file.

---

## 2026-05-09 (later) — PR #2 opened (Claude session)

### Phase
P0.5 — Mongo wire + hotels proxy + partner sign-up.

### What this PR does
- Real `GET /api/widget/hotels` — proxies `platform.impt.io/api/hotels` with edge cache
- Real `POST /api/widget/intent` — writes to KV `INTENTS` namespace (90-day TTL)
- Real `GET /api/widget/quote/{iid}` — reads from KV, returns deeplink
- Real `POST /api/partners/signup` — issues `prt_<8>` key, KV-persists, Sendgrid welcome
- Real `GET /api/partners/me` — partner dashboard data
- Shared lib: `_lib/{json,kv,keys,sendgrid}.ts`
- Mgmt-server cron: `ops/sync-mongo.mjs` drains KV → Mongo `widget_intents/_partners/_events`

### Architecture decision: KV-then-Mongo
CF Pages Functions can't speak `mongodb+srv://` (no raw TCP). Live writes go to KV
(edge-native, low latency); a nightly cron on the mgmt server (which has direct DB
access) drains KV → Mongo for long-term storage and the partner PnL ledger.

### What this PR does NOT do
- `/api/widget/reserve` — still a 501. Needs Gimmonix integration in P1.
- `/api/widget/pay` — still a 501. In-chat Stripe Checkout sessions land in PR #4 with the TG/WA bots.
- `/api/widget/webhook/{key}` — still a 501. Conversion attribution loop closes only when find-hotel-input forwards `iid` to Stripe metadata — that's a 1-line change Henry has to make in `apps/marketplace`. Brief in `ops/HENRY-ASK.md` (next).

### Mike action items (after merge)
1. Merge PR #2 (cycle 2 of autonomy ramp)
2. CF dashboard → swarm-impt project → Settings → KV bindings:
   - `wrangler kv:namespace create INTENTS` → paste ID into wrangler.toml
   - same for PARTNERS, ANALYTICS
3. CF dashboard → Settings → Environment Variables — paste from `apps/site/.env.example`:
   - SENDGRID_API_KEY + SENDGRID_FROM_EMAIL (verified sender)
   - STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (defer until /pay lands)
4. Mgmt server crontab:
   ```
   30 3 * * *  cd /home/mike/swarmimptio && node ops/sync-mongo.mjs >> /var/log/swarm-sync.log 2>&1
   ```

---

## 2026-05-09 — P0 spine PR opened (Claude session)

### Phase
P0 — Foundation (workspace + scaffold + adapters/_shared + Pages Functions for /track + /intent + /partners/signup + 30+ channel landing stubs).

### Last completed
Initial scaffold PR `feat/p0-omnichannel-spine` opened against main. No production change — site is not yet wired to Cloudflare Pages.

### In progress
Awaiting:
- Mike review + merge of PR #1
- Mike one-click: connect repo to Cloudflare Pages (`swarm-impt` project, branch `main`, build cmd `npm run site:build`, output `apps/site/public`)
- DNS swap (existing swarm.impt.io will keep serving until Pages takes over)

### Next (after PR #1 merges)
- PR #2 — wire `/api/widget/{hotels,quote,reserve,pay,webhook}` to Mongo + Stripe
- PR #3 — `apps/mcp-server/` (npm-publishable @impt/mcp-server)
- PR #4 — Telegram bot + Mini App at `/api/tg/webhook`
- PR #5 — WhatsApp Cloud API webhook at `/api/whatsapp/webhook`
- PR #6 — uptime monitor live in GitHub Actions

### Blockers (NOTIFY_MIKE)
None yet. WhatsApp Cloud API number provisioning + Apple Business Chat onboarding are P1/P3 dependencies — not P0 blockers.

### Health
- Existing live widget (`/widget.js`): 200, last-modified 2026-05-05 — untouched by this PR
- Uptime probe: not yet wired (P0 lands the workflow file, first probe runs after PR #1 merges)
- Conversion: existing widget tracking continues via the live `/api/widget/track` (Cloudflare Workers behind it). New Pages Function takes over the route only after Mike connects Pages.
