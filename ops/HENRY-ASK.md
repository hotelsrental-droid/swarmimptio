# Ask for Henry — close the conversion-attribution loop

> Authored 2026-05-09 by Claude (swarm side). Mike: forward when ready.

## What's happening

Swarm widget on `swarm.impt.io` sends users to `app.impt.io/find-hotel-input`
with `?iid=<intent_id>&utm_source=swarm-<KEY>&utm_medium=<channel>` for every
adapter (web, Telegram, WhatsApp, Instagram, MCP, ChatGPT, etc.). 30+ surfaces,
all funnelling through the same params.

Today, those params land on `find-hotel-input` and stop there — they don't
propagate to the Stripe Checkout call (`POST /api/stripe/hotel-booking-checkout`).
So the swarm webhook can't attribute Stripe `checkout.session.completed` events
back to the partner who drove the click.

## The ask (1 line of code)

In `apps/marketplace`, wherever the `find-hotel-input` page calls
`/api/stripe/hotel-booking-checkout`, add the `iid`, `utm_source`, `utm_medium`,
and `utm_campaign` from the URL into the request payload. Then in the checkout
handler, attach those onto the Stripe session as `metadata`:

```ts
// apps/marketplace/...stripe/hotel-booking-checkout.ts
const session = await stripe.checkout.sessions.create({
  // ...existing fields...
  metadata: {
    transactionId,
    swarm_iid: req.body.iid ?? null,
    swarm_source: req.body.utm_source ?? null,
    swarm_medium: req.body.utm_medium ?? null,
    swarm_campaign: req.body.utm_campaign ?? null
  }
});
```

That's it. Six lines.

## Why it matters

- 30+ channels can be revshare-ed (5%) with full attribution
- Partners get a real-time dashboard at `swarm.impt.io/partners?key=…`
- Per-channel conversion analytics (Telegram-vs-Instagram-vs-MCP)
- Closes the loop on Goodness-mechanic accounting (5% back to guest, 1 t CO₂)

## What we won't touch

Nothing else on `app.impt.io`. No new endpoints, no new dependencies, no DB
changes. Pure read-of-request-body + write-to-Stripe-metadata.

## Then on swarm side

`swarm.impt.io/api/widget/webhook/stripe` listens on a Stripe webhook,
verifies signature, reads `metadata.swarm_iid` + `metadata.swarm_source`,
matches to KV `INTENTS:intent:<iid>`, marks paid, fires partner revshare row.

## ETA

If Henry has 15 min: today. If green-light from Mike comes first: same day,
1-line PR. The swarm webhook on the other side ships in PR #3 (we already
have the KV intent records ready to match).
