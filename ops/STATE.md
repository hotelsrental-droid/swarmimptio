# STATE — Claude session ledger
> Format: append-only. Top entry is most recent. Every Claude session that touches this repo updates this file.

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
