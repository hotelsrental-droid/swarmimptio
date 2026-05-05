# Security Policy

## Reporting a vulnerability

Email **security@impt.io** with the subject "Swarm Widget security report".

Please include:
- A clear description of the issue and impact
- Reproduction steps (proof-of-concept welcome, ideally non-destructive)
- Whether you believe it has been exploited in the wild
- Whether you wish to be credited publicly

We will acknowledge receipt within **48 hours** and aim to triage within **5 business days**.

## Disclosure timeline

- **Day 0**: report received
- **Day 0–5**: triage + severity assessment
- **Day 5–60**: fix developed, deployed, and verified
- **Day 90**: public disclosure (CVE issued where applicable)

We will work with you on extensions if a longer fix window is genuinely needed. We will not pursue legal action against good-faith research that respects this policy.

## Scope

In scope:
- This repository (`@impt/swarm-widget`, the widget code)
- The IMPT-hosted API at `https://swarm.impt.io/api/widget/*`
- The hosted widget bundle at `https://swarm.impt.io/widget.js`
- Attribution / commission integrity

Out of scope:
- The IMPT booking platform itself (`app.impt.io`) — report those to security@impt.io with a separate scope tag
- Issues requiring a privileged position on a victim's device
- Self-XSS, social engineering, physical attacks
- Vulnerabilities in third-party dependencies that we have already patched
- Reports from automated scanners without analysis

## Bug bounty

We do not currently run a paid bounty programme. We are happy to:
- Credit researchers in `THANKS.md` (with permission)
- Issue **IMPT travel credit** (€100–€2,000 depending on severity) at our discretion
- Provide a public statement of thanks for high-impact reports

## Hardening already in place (launch v0.1.0)

- Per-IP rate limits on `/signup`, `/r`, `/track`, `/booking`, `/verify`
- Bot user-agent filter on `/r` (the commission-driving redirect)
- Body-size cap (8KB) on widget endpoints
- Email verification required before a partner key activates (`pending_email` → `active`)
- Disposable-email-domain blocklist + honeypot field on signup
- HMAC-signed booking webhook (`X-IMPT-Signature: sha256=…`)
- Audit log on all partner-state changes
- Cookies set first-party `*.impt.io`, `Secure`, `SameSite=Lax`
- Inactive keys do **not** receive cookie/UTM attribution (graceful 302)
- IP and user-agent values are SHA-256-hashed before storage; raw values not retained

## Out-of-band contacts

If `security@impt.io` is unreachable or unresponsive after 7 days, escalate to:
- mike@impt.io
- A signed PGP message (key fingerprint published at https://impt.io/.well-known/pgp.txt — placeholder until v0.2)

— IMPT Systems Limited
