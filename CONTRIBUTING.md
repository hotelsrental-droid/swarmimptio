# Contributing to IMPT Swarm Widget

Thanks for your interest!

## Quick start

```bash
git clone https://github.com/IMPTSystem/impt-swarm-widget
cd impt-swarm-widget
npm install
npm run dev      # opens demo at http://localhost:5173
npm run build    # produces dist/widget.js (UMD), dist/widget.esm.js, dist/widget.cjs.js
npm run size     # checks gzipped budget (12KB max)
```

## Submitting a PR

1. Fork + branch from `main`.
2. Keep changes focused — one feature / fix per PR.
3. Add an example in `examples/` if your change affects integration.
4. Update docs if your change is user-facing.
5. CI must pass: lint + tests + size budget.
6. Sign-off your commit (DCO).

## What we'll merge fast

- New framework wrappers (Vue, Svelte, Astro, Solid).
- WordPress / Shopify / Wix / Webflow plugins.
- i18n translations.
- Accessibility fixes.
- Bundle-size reductions.
- Docs improvements.

## What we'll discuss before merging

- New runtime dependencies (we keep zero-dep where possible).
- Tracking / analytics changes — we have a privacy commitment.
- Breaking API changes.
- Anything that risks the 12KB budget.

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Be kind. We're all here to make travel less destructive.

## Questions

Open a discussion on GitHub or email `swarm-widget@impt.io`.
