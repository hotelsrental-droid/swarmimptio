# IMPT Swarm Widget

> The open-source hotel-search widget that pays you 5%.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bundle size](https://img.shields.io/badge/gzipped-%3C12KB-brightgreen)](#)
[![Made by IMPT](https://img.shields.io/badge/made%20by-IMPT-08423a)](https://impt.io)

One line. Drop it anywhere. Earn **5%** on every confirmed hotel booking. A tree planted per stay in your name.

```html
<script src="https://swarm.impt.io/widget.js" data-key="YOUR_KEY" async></script>
<div id="impt-swarm"></div>
```

[Get a partner key](https://partners.impt.io/widget) · [Live demo](https://swarm.impt.io/widget) · [Docs](./docs/integration.md)

---

## Why this exists

Booking.com pays affiliates 4%. Expedia pays 4%. They're closed boxes.

We're building IMPT — the hotel platform that offsets a tonne of carbon per booking and gives 5% back to your guest as Goodness loyalty (3% to a cause they choose, 2% to their next stay). And we want the world to embed our search.

So we open-sourced our widget. **5% to you, MIT licence, no rules.**

If you run a hotel, a travel blog, a country guide, an ESG platform, or a personal site that mentions hotels even once — you can drop this in and start earning.

## What you get

- **5% commission** on every confirmed, checked-in booking. Paid monthly. Wise / PayPal / IMPT card / IMPT token.
- **A 90-day attribution cookie.** Better than Booking.com (30 days) and Expedia (7 days).
- **A tree planted per booking** in *your* name (you choose the cause).
- **Real-time dashboard** at [partners.impt.io/widget](https://partners.impt.io/widget).
- **Zero cost.** No setup fees. No minimums. No traffic requirements. No sales call.

## How it works

1. [Sign up](https://partners.impt.io/widget) → get a partner key.
2. Drop the snippet on your page.
3. Guest searches → lands on `app.impt.io` → books a hotel.
4. You earn 5% of the base booking value.
5. Monthly payout once balance crosses €50.

## Install

### One-line embed (any site)

```html
<script src="https://swarm.impt.io/widget.js" data-key="YOUR_KEY" async></script>
<div id="impt-swarm"></div>
```

### npm

```bash
npm i @impt/swarm-widget
```

```ts
import { mountSwarm } from '@impt/swarm-widget'
mountSwarm('#impt-swarm', { key: 'YOUR_KEY' })
```

### React

```tsx
import { ImptSwarm } from '@impt/swarm-widget/react'

export default function Page() {
  return <ImptSwarm partnerKey="YOUR_KEY" />
}
```

### WordPress

```
[impt-swarm key="YOUR_KEY"]
```

### Shopify

Drop the `swarm-widget.liquid` block into your theme.

## Configuration

| Attribute | Default | Description |
|---|---|---|
| `data-key` | required | Your partner key from partners.impt.io |
| `data-cause` | `trees` | `trees` / `ocean` / `bronagh` / `custom` |
| `data-theme` | `cream` | `cream` / `dark` / `auto` |
| `data-dest` | none | Optional pre-fill destination, e.g. `Dublin` |
| `data-currency` | auto | `EUR` / `USD` / `GBP` — defaults to destination currency |
| `data-lang` | `en` | Reserved for i18n PRs |

## Attribution

- **Last-touch wins.** If a guest clicks two partner widgets, the most recent gets paid.
- **90-day cookie.** Set on `*.impt.io` first-party. No tracking on your domain.
- **Cross-device** carries on the user record once they sign in.
- **Cancellations reverse.** You get paid for confirmed, non-refundable, checked-in bookings.

Read the full [attribution doc](./docs/attribution.md).

## Bundle size

We're allergic to widget bloat. Every release is checked against a **12KB gzipped** budget. CI fails the build if it goes over.

## Privacy

- No third-party trackers fired from the widget.
- No cookies set on your domain — only first-party `*.impt.io`.
- Open-source: read every line of [`src/`](./src) yourself.
- GDPR / ePrivacy compatible. Consent banner integration documented.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Wishlist:
- WordPress / Shopify / Wix native plugins
- i18n (we ship in English; community = the world)
- Vue + Svelte component wrappers
- Theme presets

## Licence

MIT. Use it for anything. Even competitors. (We're confident.)

## Legal + security

- [Partner Terms](./TERMS.md) — commission, payout, what you must not do.
- [Privacy](./PRIVACY.md) — what data we collect, why, retention.
- [Security policy](./SECURITY.md) — vulnerability reporting, disclosure timeline, scope.

## About IMPT

[IMPT](https://impt.io) is a hotel booking + carbon offset platform. 195 countries. 1.7M hotel URLs. €5 free signup credit. 5% Goodness back per booking — 3% to a cause, 2% to your next stay. Building the world's first AI hotel system.

This widget is part of how we get there.

— Mike, Henry, AJ, Julia, San, Harshal & the IMPT team

---

🌍 *Hotels with conscience. Now embeddable everywhere.*
