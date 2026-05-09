# STATE — Claude session ledger
> Format: append-only. Top entry is most recent. Every Claude session that touches this repo updates this file.

---

## 2026-05-09 (LIVE) — production deploy applied directly to mgmt-server

### Discovery that flipped the architecture
swarm.impt.io is **NOT** Cloudflare Pages. DNS resolves to `35.214.111.96` (this mgmt-server). nginx serves static + reverse-proxies `/api/widget/*` to a Python FastAPI on `localhost:2027` (`impt-swarm-widget.service`, systemd-managed).

### What got deployed live (not just opened-as-PR)
- **`apps/server/swarm_widget_api.py`** mirrors the live `/srv/swarm/impt-swarm-oss-2026-05-05/backend/swarm_widget_api.py` after I appended ~750 lines:
  - `POST /api/widget/intent` — JSON intent + canonical deeplink + embed + qr URL (KV-equivalent in SQLite)
  - `GET /api/widget/quote/{iid}` — intent lookup
  - `GET /api/widget/hotels` — proxy `platform.impt.io/api/hotels` (no cache yet — Python edge cache TBD)
  - `GET /api/widget/qr/{key}.png` + `.svg` — real QR generator (`segno`)
  - `GET /api/email/sig/{key}` — paste-ready Outlook-safe signature snippet
  - `GET /api/gpt/openapi.json` — Custom GPT Action manifest
  - `POST /api/mcp/http` — Streamable HTTP MCP server with 4 tools (`impt_search_hotels`, `impt_create_intent`, `impt_get_quote`, `impt_get_deeplink`)
  - `GET /api/mcp/info` — paste-ready Claude Desktop / Claude Code config
  - `POST /api/tg/webhook` — Telegram bot (LIVE, secret-token verified, smart heuristic for non-city text)
  - `GET+POST /api/whatsapp/webhook` — Meta Cloud API (waiting on tokens)
  - `GET+POST /api/fb/webhook` — Meta Messenger Platform (waiting on tokens)
  - SQLite tables added: `intents`, `bot_events`
  - Idempotent `swarm-` prefix in `build_deeplink` so partner keys never double-prefix
- **`ops/nginx-swarm.impt.io.conf`** mirrors the live nginx config (`/etc/nginx/sites-enabled/swarm.impt.io`) with my added location blocks for `/api/tg/webhook`, `/api/whatsapp/`, `/api/fb/`, `/api/(email|gpt|mcp)/`, `/api/widget/qr/.*\.(png|svg)$`
- **`apps/site/public/widget/index.html`** mirrors the new live homepage at `swarm.impt.io/widget`
- **`apps/site/public/mcp/index.html`** updated to show LIVE status and real install commands (HTTP transport)

### Live state (verified by curl)
- `https://swarm.impt.io/widget` 200 (22.6 KB cream-skin homepage)
- `https://swarm.impt.io/{tg,wa,fb,ig,...,partners}` all 200
- `t.me/Rambo_Marc2_bot` webhook = `https://swarm.impt.io/api/tg/webhook` (secret-token set, pending=0)
- `POST /api/widget/intent` — issues `iid_*` + canonical deeplink with `utm_source=swarm-<key>` (idempotent prefix)
- `POST /api/mcp/http` — JSON-RPC 2.0, returns 4 tools, executes `impt_get_deeplink` end-to-end
- `GET /api/widget/qr/<key>.png` — real QR PNG (1.2 KB, ink/cream palette)
- `GET /api/email/sig/<key>` — paste-ready HTML signature
- `GET /api/gpt/openapi.json` — Custom GPT Action manifest
- monitor.mjs cron `*/30 * * * *` running, all 40 probes green

### Live test events Mike has already done
The DB has 6+ real intents from chat_id `8103309746` (Mike) including "Rambo? 😂" (now correctly rejected by the heuristic) and "There are still a lot of bugs..." (also rejected).

### Backup files (rollback safe)
- `/etc/nginx/sites-enabled/swarm.impt.io.bak-pre-bots-20260509-103947`
- `/srv/swarm/impt-swarm-oss-2026-05-05/demo/index.html.bak-pre-omnichannel`

---

## 2026-05-09 (earlier) — PR #3 opened: bots + big homepage refresh

### Phase
P1 — Telegram + WhatsApp + Facebook webhooks; refreshed swarm.impt.io homepage.

### What this PR does
- **`/api/tg/webhook`** — full Telegram bot. `/start` city picker, `/book Dublin` deeplink, plain-text city handler, callback queries. Uses existing `TELEGRAM_BOT_TOKEN` from `/home/mike/impt-management/.env` (bot is `@Rambo_Marc2_bot` — Mike can rename via @BotFather)
- **`/api/whatsapp/webhook`** — Meta Cloud API receiver: GET verification + POST text/interactive message handler with `cta_url` reply. Webhook is wired but inert until Mike provisions a WA Business number
- **`/api/fb/webhook`** — Meta Messenger Platform receiver: GET verification + POST quick-reply + postback handler with generic-template card. Wired but inert until Mike adds the IMPT Page to the Messenger app
- **Updated `/tg /wa /fb` landing pages** — point at real bots / m.me link, "Try it" instructions
- **Big homepage refresh** at `/` — hero with 6 stats, live demo widget, all 36 channels grouped by tier with status pills (Live / P1 / P2 / P3 / P4 / P5), how-it-works flow, Goodness mechanic dark panel, comparison table vs Booking/Expedia, real partner sign-up form
- **`ops/SETUP.md`** — exact one-shot commands Mike runs after merging: CF Pages connect, KV bindings, env vars, Telegram webhook curl, mgmt-server crons
- `_redirects` adds `/widget → /` (legacy partner inbound links)

### Why workflows are still in `ops/workflows/`
gh OAuth token lacks `workflow` scope → can't push under `.github/workflows/`. Refresh requires browser interaction. **Resolution:** monitor + sync crons run on mgmt server (where direct Mongo + CF API access live anyway), same pattern as `brain-tick`. Workflows in `ops/workflows/` are templates Mike can paste via web UI later.

### Mike test checklist (after CF Pages + Telegram webhook are set)
- [ ] **TG:** `t.me/Rambo_Marc2_bot?start=Dublin` → city picker, tap city → booking link
- [ ] **WA:** swarm.impt.io/wa → wa.me opens → message bot (after Meta provisioning)
- [ ] **FB:** swarm.impt.io/fb → m.me/imptio → message page (after Meta provisioning)
- [ ] **Web:** swarm.impt.io → demo widget on home → pick city → find-hotel-input

---

## 2026-05-09 (mid) — PR #2 opened (Claude session)

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
