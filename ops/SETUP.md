# Setup — one-shot commands Mike runs after the PRs merge

> Everything below is **post-merge**. Order matters: connect CF Pages first, then KV, then bots.

## 1. Connect Cloudflare Pages (5 minutes)

CF dashboard → Pages → **Create project** → **Connect to Git** → pick `hotelsrental-droid/swarmimptio`.

- **Branch:** `main`
- **Build command:** `npm run site:build`
- **Build output directory:** `apps/site/public`
- **Root directory:** leave blank (repo root)

Save → first build runs automatically.

## 2. Bind 3 KV namespaces

Run on the management server (already has CLOUDFLARE_API_TOKEN):

```bash
cd /home/mike/swarmimptio
npx wrangler login   # one-time interactive (or use API token)

# Create namespaces
npx wrangler kv:namespace create INTENTS
npx wrangler kv:namespace create PARTNERS
npx wrangler kv:namespace create ANALYTICS
```

Wrangler prints IDs — paste them into `apps/site/wrangler.toml` (replace `REPLACE_WITH_KV_ID`), commit, push. CF Pages auto-redeploys.

## 3. Set CF Pages env (Settings → Environment variables → Production)

Source values from `/home/mike/impt-management/vercel-env-backup/impt-marketplace.env`:

| Var | Why |
|---|---|
| `STRIPE_SECRET_KEY` | Future `/pay` checkout sessions (PR #4+) |
| `STRIPE_WEBHOOK_SECRET` | Future webhook signature verification |
| `SENDGRID_API_KEY` | Partner welcome emails |
| `SENDGRID_FROM_EMAIL` | e.g. `partners@impt.io` (must be verified sender on Sendgrid) |
| `TG_BOT_TOKEN` | From `/home/mike/impt-management/.env` (`TELEGRAM_BOT_TOKEN`) |
| `TG_WEBHOOK_SECRET` | Generate one: `openssl rand -hex 32` |
| `WA_PHONE_NUMBER_ID` | After Meta Business verification — paste from Meta dev portal |
| `WA_TOKEN` | Long-lived system user token from Meta dev portal |
| `WA_VERIFY_TOKEN` | Generate one: `openssl rand -hex 32` |
| `FB_PAGE_ACCESS_TOKEN` | Meta dev portal → Messenger → Page Access Token |
| `FB_VERIFY_TOKEN` | Generate one: `openssl rand -hex 32` |
| `FB_PAGE_USERNAME` | e.g. `imptio` — used for `m.me/<username>` deeplinks |

## 4. Set the Telegram webhook (1 curl)

```bash
TG_BOT_TOKEN=$(grep ^TELEGRAM_BOT_TOKEN= /home/mike/impt-management/.env | cut -d= -f2-)
TG_WEBHOOK_SECRET=$(openssl rand -hex 32)  # save this — paste into CF env too
curl -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook" \
  -d "url=https://swarm.impt.io/api/tg/webhook" \
  -d "secret_token=${TG_WEBHOOK_SECRET}" \
  -d "allowed_updates[]=message" \
  -d "allowed_updates[]=callback_query"
```

Verify:
```bash
curl "https://api.telegram.org/bot${TG_BOT_TOKEN}/getWebhookInfo"
```

Then **chat with `@Rambo_Marc2_bot`** on Telegram (this is the bot the existing token belongs to — you can rename via @BotFather any time):
- `/start` → city picker buttons
- `/book Dublin` → reply with one-tap booking link
- type "Paris" → same

## 5. Set the WhatsApp + FB webhooks (Meta dev portal)

After Mike provisions WA Business + IMPT Page in Meta dev portal:

**WhatsApp** → Cloud API → Configuration → Webhook URL = `https://swarm.impt.io/api/whatsapp/webhook` · verify token = `$WA_VERIFY_TOKEN` · subscribe: `messages`, `message_status`

**Messenger** → Webhooks → URL = `https://swarm.impt.io/api/fb/webhook` · verify token = `$FB_VERIFY_TOKEN` · subscribe to Page · events: `messages`, `messaging_postbacks`

## 6. Mongo sync cron (mgmt server)

Once KV namespace IDs are in place, append the IDs to `/home/mike/impt-management/.env`:

```bash
KV_INTENTS_ID=<id>
KV_PARTNERS_ID=<id>
KV_ANALYTICS_ID=<id>
CF_ACCOUNT_ID=<from CF dashboard>
```

Then crontab (`crontab -e`):

```cron
30 3 * * *  cd /home/mike/swarmimptio && set -a && source /home/mike/impt-management/.env && set +a && node ops/sync-mongo.mjs >> /var/log/swarm-sync.log 2>&1
*/30 * * * *  cd /home/mike/swarmimptio && BASE=https://swarm.impt.io node ops/monitor.mjs >> /var/log/swarm-monitor.log 2>&1 || mail -s "swarm.impt.io probe failed" mike@impt.io < /var/log/swarm-monitor.log
```

(Monitor cron lives on mgmt server because GitHub Actions can't be added without `workflow` scope on the OAuth token — same pattern as `brain-tick`.)

## 7. Test what Mike asked for

- **Web widget:** visit `https://swarm.impt.io/` — pick a city → lands on `app.impt.io/find-hotel-input`
- **Telegram:** `t.me/Rambo_Marc2_bot?start=Dublin` → bot greets + button → tap → booking
- **WhatsApp:** `swarm.impt.io/wa` → WA opens with prefilled "Book Dublin" message → bot replies (after Meta provisioning)
- **Facebook:** `swarm.impt.io/fb` → opens Messenger to IMPT page → send "Paris" → bot replies (after Meta provisioning)

If any step 5xx, check Cloudflare Pages logs and `ops/RUNBOOK.md`.
