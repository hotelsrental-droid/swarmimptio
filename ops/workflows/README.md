# Pending GitHub Actions workflows

The OAuth token used by Claude Code does not carry `workflow` scope, so these
files cannot be pushed under `.github/workflows/` directly. To activate:

1. In the GitHub web UI, navigate to the repo → **Actions** tab
2. Use **New workflow** → **set up a workflow yourself**
3. Paste the contents of each `.yml` in this folder into a file at
   `.github/workflows/<filename>.yml`
4. Commit via the web UI (this requires no extra permissions)

Or grant the IMPTio gh token a `workflow` scope and re-push:

```
gh auth refresh -h github.com -s workflow
git mv ops/workflows/*.yml .github/workflows/
git commit -m "ci: enable workflows"
git push
```

## Current workflows

- `monitor.yml` — every 30 min, probes every `/<channel>` URL on `swarm.impt.io`
- `deploy-pages.yml` — INERT until `vars.ENABLE_DEPLOY=true` AND CF secrets set
