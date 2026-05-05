# Integration Guide

## 60-second integration

1. [Sign up for a key](https://partners.impt.io/widget) (your email + payout method).
2. Drop two lines on any page:

```html
<script src="https://swarm.impt.io/widget.js" data-key="YOUR_KEY" async></script>
<div id="impt-swarm"></div>
```

3. That's it. The widget renders a cream-skin search box. Every booking earned through it credits 5% to your key.

## Where to put it

- **Sidebar** of a travel blog
- **Footer** of a hotel's own site (to capture nearby-area searches)
- **Resource page** ("Where to stay") of a country guide
- **Booking-page bottom** of an airline / car-rental site
- **Newsletter** (use a hosted preview link)

## Per-page targeting

Pre-fill the destination so guests land 1 step ahead:

```html
<script src="https://swarm.impt.io/widget.js"
        data-key="YOUR_KEY"
        data-dest="Dublin"
        async></script>
<div id="impt-swarm"></div>
```

## Multiple widgets on one page

Each widget needs its own host div. The script auto-mounts the first one named `#impt-swarm`. For more, mount programmatically:

```html
<div id="hero"></div>
<div id="footer"></div>

<script src="https://swarm.impt.io/widget.js" data-key="YOUR_KEY" async></script>
<script>
  window.addEventListener('load', function () {
    if (!window.ImptSwarm) return;
    window.ImptSwarm.mount('#hero', { key: 'YOUR_KEY', dest: 'Dublin' });
    window.ImptSwarm.mount('#footer', { key: 'YOUR_KEY' });
  });
</script>
```

## SPAs / framework apps

See `examples/react.jsx` for React. Vue / Svelte / Astro examples in PRs welcome.

## Theming (coming soon)

The widget ships with a single cream skin matching IMPT brand. CSS-variable overrides land in v0.2.

## Privacy / consent

The widget fires no third-party trackers. A single first-party pixel (`swarm.impt.io/api/widget/track`) records:
- Partner key + event type (`view` / `click`)
- Approximate timestamp
- Referrer hostname (e.g. `your-blog.com`)

If you operate under GDPR / ePrivacy, treat that pixel as functional / first-party affiliate. The widget can be lazy-mounted behind a consent gate — see `docs/privacy.md`.
