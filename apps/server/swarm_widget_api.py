#!/usr/bin/env python3
"""
IMPT Swarm Widget — attribution + partner signup backend.

FastAPI service. Runs on :2027 behind nginx at swarm.impt.io/api/widget/*.
SQLite for tonight; migrate to Postgres on day 30.

Security wall (2026-05-05):
  * nginx-side per-IP rate limits + bot-UA filter on /r
  * email verification before key activates (pending_email → active)
  * disposable-email domain block + honeypot field on signup
  * HMAC-signed booking webhook (X-IMPT-Signature: sha256=hex)
  * audit log on every state-change
  * /r refuses to attribute for non-active keys (graceful 302, no cookie/utm)

Endpoints
---------
  GET  /api/widget/health
  POST /api/widget/partners/signup     { email, name, payout_method, payout_target, hp? }
  GET  /api/widget/verify              ?token=  → flips key to active
  GET  /api/widget/r                   ?key=&dest=  302 → lander + cookie (only if active)
  GET  /api/widget/track               ?key=&evt=&dest=&ref=  1x1 GIF + log
  POST /api/widget/booking             X-IMPT-Signature header  → 5% accrual
  GET  /api/widget/partners/me         Bearer auth → balance + history
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

DB_PATH = os.environ.get("SWARM_WIDGET_DB", "/home/mike/impt-swarm-oss-2026-05-05/backend/swarm_widget.db")
LANDER = "https://app.impt.io/find-hotel-input"
COOKIE_DAYS = 90
COMMISSION_PCT = 0.05
WEBHOOK_SECRET = os.environ.get("SWARM_WIDGET_WEBHOOK_SECRET", "set-me-in-env")
PUBLIC_BASE = os.environ.get("SWARM_WIDGET_PUBLIC_BASE", "https://swarm.impt.io")
GMAIL_CREDS = os.environ.get("SWARM_WIDGET_GMAIL_CREDS", "/home/mike/impt-management/credentials.json")
GMAIL_SENDER = os.environ.get("SWARM_WIDGET_GMAIL_SENDER", "cto-office@impt.io")
GMAIL_FROM_NAME = os.environ.get("SWARM_WIDGET_GMAIL_FROM_NAME", "IMPT Swarm")
GMAIL_REPLY_TO = os.environ.get("SWARM_WIDGET_REPLY_TO", "mike@impt.io")

GIF_1x1 = bytes.fromhex("47494638396101000100800000ffffff00000021f90401000001002c00000000010001000002024401003b")

# Disposable / throwaway email-domain blocklist. Not exhaustive; we add as we see.
DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com",
    "10minutemail.net", "tempmail.com", "temp-mail.org", "throwawaymail.com",
    "yopmail.com", "trashmail.com", "trashmail.net", "maildrop.cc", "sharklasers.com",
    "getairmail.com", "mailnesia.com", "mintemail.com", "fakeinbox.com",
    "spamgourmet.com", "dispostable.com", "fakemailgenerator.com", "tempinbox.com",
    "emailondeck.com", "mohmal.com", "mytemp.email", "mvrht.net", "tempr.email",
    "burnermail.io", "byom.de", "spambox.us", "moakt.com",
}

app = FastAPI(title="IMPT Swarm Widget API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*", "X-IMPT-Signature"],
    max_age=86400,
)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as c:
        # Migrate existing schema additively before creating fresh.
        existing = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='partners'").fetchone()
        if existing:
            cols = {r[1] for r in c.execute("PRAGMA table_info(partners)").fetchall()}
            for col, ddl in [
                ("verify_token", "ALTER TABLE partners ADD COLUMN verify_token TEXT"),
                ("verified_at", "ALTER TABLE partners ADD COLUMN verified_at INTEGER"),
                ("signup_ip_hash", "ALTER TABLE partners ADD COLUMN signup_ip_hash TEXT"),
            ]:
                if col not in cols:
                    c.execute(ddl)
        c.executescript("""
        CREATE TABLE IF NOT EXISTS partners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          email TEXT NOT NULL,
          name TEXT,
          payout_method TEXT NOT NULL,
          payout_target TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending_email',
          api_token TEXT UNIQUE NOT NULL,
          verify_token TEXT,
          verified_at INTEGER,
          signup_ip_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_partners_email ON partners(email);
        CREATE INDEX IF NOT EXISTS idx_partners_verify ON partners(verify_token);
        CREATE TABLE IF NOT EXISTS partner_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          evt TEXT NOT NULL,
          dest TEXT,
          ref TEXT,
          ip_hash TEXT,
          ua_hash TEXT,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_key ON partner_events(key);
        CREATE INDEX IF NOT EXISTS idx_events_ts ON partner_events(ts);
        CREATE TABLE IF NOT EXISTS partner_bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          partner_key TEXT NOT NULL,
          booking_id TEXT UNIQUE NOT NULL,
          base_value_cents INTEGER NOT NULL,
          currency TEXT NOT NULL,
          accrual_eur_cents INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          booked_at INTEGER NOT NULL,
          check_in_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bookings_key ON partner_bookings(partner_key);
        CREATE TABLE IF NOT EXISTS partner_payouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          partner_key TEXT NOT NULL,
          amount_eur_cents INTEGER NOT NULL,
          period_start INTEGER NOT NULL,
          period_end INTEGER NOT NULL,
          paid_at INTEGER,
          method TEXT,
          ref TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          subject TEXT,
          detail TEXT,
          ip_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log(subject);
        """)


def hash_ip(ip: str) -> str:
    return hashlib.sha256((ip + "|impt-swarm-2026").encode()).hexdigest()[:16]


def hash_ua(ua: str) -> str:
    return hashlib.sha256((ua or "").encode()).hexdigest()[:16]


def to_eur_cents(amount: float, currency: str) -> int:
    rates = {"EUR": 1.0, "USD": 0.92, "GBP": 1.18, "JPY": 0.0061, "AUD": 0.61, "CAD": 0.68,
             "CHF": 1.05, "SGD": 0.69, "AED": 0.25, "THB": 0.027}
    return int(amount * rates.get(currency.upper(), 1.0) * 100)


def audit(action: str, subject: Optional[str], detail: Optional[dict], ip_hash: Optional[str] = None,
          actor: str = "system") -> None:
    with db() as c:
        c.execute(
            "INSERT INTO audit_log(ts,actor,action,subject,detail,ip_hash) VALUES (?,?,?,?,?,?)",
            (int(time.time()), actor, action, subject,
             json.dumps(detail) if detail else None, ip_hash)
        )


def is_valid_email(email: str) -> bool:
    if not email or "@" not in email or len(email) > 200:
        return False
    domain = email.rsplit("@", 1)[-1].strip().lower()
    if domain in DISPOSABLE_DOMAINS:
        return False
    if not re.match(r"^[a-z0-9.\-]+\.[a-z]{2,}$", domain):
        return False
    return True


def send_verify_email(email: str, name: Optional[str], partner_key: str, verify_token: str) -> bool:
    """Send verification email via Gmail API service-account. Falls back to log-only if creds absent."""
    verify_url = f"{PUBLIC_BASE}/api/widget/verify?token={verify_token}"
    body = f"""Hi{(' ' + name) if name else ''},

Welcome to the IMPT Swarm Widget — the open-source hotel-search widget that pays you 5%.

Confirm your email to activate your partner key:

  {verify_url}

Once active you can drop the embed snippet on any page:

  <script src="https://swarm.impt.io/widget.js" data-key="{partner_key}" async></script>
  <div id="impt-swarm"></div>

You earn 5% on every confirmed booking. Paid monthly once you cross €50.

If you didn't sign up, ignore this email — the key won't activate.

— IMPT Swarm
  swarm-widget@impt.io
  https://swarm.impt.io/widget
"""
    try:
        from email.mime.text import MIMEText
        from email.utils import formataddr
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        creds = service_account.Credentials.from_service_account_file(
            GMAIL_CREDS, scopes=["https://www.googleapis.com/auth/gmail.send"]
        ).with_subject(GMAIL_SENDER)
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        msg = MIMEText(body)
        msg["to"] = email
        msg["from"] = formataddr((GMAIL_FROM_NAME, GMAIL_SENDER))
        msg["reply-to"] = GMAIL_REPLY_TO
        msg["subject"] = "Confirm your IMPT Swarm partner key"
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
        print(f"[swarm-widget] verify email sent: id={result.get('id')} to={email}", flush=True)
        return True
    except Exception as e:
        print(f"[swarm-widget] send_verify_email FAILED: {e}", flush=True)
        return False


# ── models ──────────────────────────────────────────────────────────

class SignupReq(BaseModel):
    email: EmailStr
    name: Optional[str] = Field(None, max_length=120)
    payout_method: str = Field(..., pattern="^(wise|paypal|stripe|impt-card|impt-token)$")
    payout_target: str = Field(..., min_length=2, max_length=200)
    hp: Optional[str] = Field(None, max_length=200)  # honeypot — must be empty/None


class BookingHookBody(BaseModel):
    booking_id: str = Field(..., min_length=2, max_length=120)
    partner_key: str = Field(..., min_length=4, max_length=64)
    base_value: float = Field(..., ge=0, le=1_000_000)
    currency: str = Field(..., min_length=3, max_length=3)
    booked_at: Optional[int] = None
    check_in_at: Optional[int] = None
    secret: Optional[str] = None  # legacy fallback (deprecated, ok for 7 days)


# ── routes ──────────────────────────────────────────────────────────

@app.get("/api/widget/health")
def health():
    return {"ok": True, "ts": int(time.time()), "version": "0.1.0"}


@app.post("/api/widget/partners/signup")
def signup(body: SignupReq, request: Request):
    ip_h = hash_ip(request.client.host if request.client else "")

    # Honeypot check (silent reject — return fake success to avoid signalling).
    if body.hp:
        audit("signup.honeypot_trip", subject=body.email, detail={"hp_len": len(body.hp)}, ip_hash=ip_h)
        return {"key": "p_pending", "ok": True}

    if not is_valid_email(body.email):
        audit("signup.bad_email", subject=body.email, detail=None, ip_hash=ip_h)
        raise HTTPException(400, "email rejected (disposable or malformed)")

    # Per-email burst control: max 2 pending signups in last 24h per email.
    with db() as c:
        recent = c.execute(
            "SELECT COUNT(*) AS n FROM partners WHERE email=? AND created_at > ?",
            (body.email, int(time.time()) - 86400)
        ).fetchone()["n"]
    if recent >= 2:
        audit("signup.email_burst", subject=body.email, detail={"recent_24h": recent}, ip_hash=ip_h)
        raise HTTPException(429, "too many signups for this email recently")

    key = "p_" + secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:12].lower()
    api_token = secrets.token_urlsafe(32)
    verify_token = secrets.token_urlsafe(24)
    with db() as c:
        try:
            c.execute(
                "INSERT INTO partners(key,email,name,payout_method,payout_target,created_at,status,api_token,verify_token,signup_ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (key, body.email, body.name, body.payout_method, body.payout_target,
                 int(time.time()), "pending_email", api_token, verify_token, ip_h)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "key collision, retry")

    sent = send_verify_email(body.email, body.name, key, verify_token)
    audit("signup.created", subject=key, detail={"email": body.email, "verify_sent": sent}, ip_hash=ip_h)

    return {
        "key": key,
        "status": "pending_email",
        "verify_email_sent": sent,
        "message": "Check your email and click the verification link to activate your key.",
        "embed_preview": f'<script src="https://swarm.impt.io/widget.js" data-key="{key}" async></script>\n<div id="impt-swarm"></div>',
    }


@app.get("/api/widget/verify")
def verify(token: str = Query(..., min_length=10, max_length=100), request: Request = None):
    ip_h = hash_ip(request.client.host if (request and request.client) else "")
    with db() as c:
        row = c.execute("SELECT key, status, email, api_token FROM partners WHERE verify_token=?", (token,)).fetchone()
        if not row:
            raise HTTPException(404, "invalid or expired token")
        if row["status"] == "active":
            html_body = f"<p>Already verified.</p>"
            return HTMLResponse(content=verify_page("Already verified", html_body))
        c.execute(
            "UPDATE partners SET status='active', verified_at=?, verify_token=NULL WHERE verify_token=?",
            (int(time.time()), token)
        )
    audit("signup.verified", subject=row["key"], detail={"email": row["email"]}, ip_hash=ip_h)
    snippet = f'&lt;script src="https://swarm.impt.io/widget.js" data-key="{row["key"]}" async&gt;&lt;/script&gt;\n&lt;div id="impt-swarm"&gt;&lt;/div&gt;'
    body_html = f"""
    <p>Your partner key is <strong>active</strong>.</p>
    <p>Embed it on any page:</p>
    <pre>{snippet}</pre>
    <p>API token (keep this private — you'll use it for the dashboard):</p>
    <pre>{row['api_token']}</pre>
    <p>Earnings dashboard: <a href="https://partners.impt.io/widget">partners.impt.io/widget</a></p>
    """
    return HTMLResponse(content=verify_page("Verified ✓", body_html))


def verify_page(title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title} — IMPT Swarm</title>
<style>body{{font-family:Inter,system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 24px;color:#08423a;background:#FAF7F0}}
h1{{font-family:Fraunces,Georgia,serif;font-weight:600}} pre{{background:#08423a;color:#FAF7F0;padding:18px;border-radius:12px;overflow-x:auto;font-size:13px}}
a{{color:#08423a}}</style></head><body>
<h1>{title}</h1>{body_html}
<p style="margin-top:40px;color:#3a6b62;font-size:13px">— IMPT Swarm · <a href="/widget">back to demo</a></p>
</body></html>"""


@app.get("/api/widget/r")
def redirect(request: Request, key: str = Query(..., min_length=4, max_length=64), dest: Optional[str] = None):
    ip_h = hash_ip(request.client.host if request.client else "")
    with db() as c:
        partner = c.execute("SELECT status FROM partners WHERE key=?", (key,)).fetchone()
        # Always log the click attempt for audit.
        c.execute(
            "INSERT INTO partner_events(key,evt,dest,ref,ip_hash,ua_hash,ts) VALUES (?,?,?,?,?,?,?)",
            (key, "click" if (partner and partner["status"] == "active") else "click_inactive",
             dest, request.headers.get("referer", ""), ip_h,
             hash_ua(request.headers.get("user-agent", "")), int(time.time()))
        )

    qs = []
    set_cookie = False
    if partner and partner["status"] == "active":
        qs = [f"utm_source=swarm-{key}", "utm_medium=widget", "utm_campaign=oss"]
        set_cookie = True
    # If key inactive/unknown: redirect anyway (graceful UX) but no commission attribution.
    if dest:
        qs.append(f"destination={dest}")
        qs.append(f"locationName={dest}")
    target = LANDER + ("?" + "&".join(qs) if qs else "")
    resp = RedirectResponse(url=target, status_code=302)
    if set_cookie:
        resp.set_cookie(
            key="impt_partner",
            value=key,
            max_age=COOKIE_DAYS * 86400,
            domain=".impt.io",
            path="/",
            secure=True,
            httponly=False,
            samesite="lax",
        )
    return resp


@app.get("/api/widget/track")
def track(request: Request, key: str = Query(..., max_length=64), evt: str = Query(..., max_length=20),
          dest: Optional[str] = None, ref: Optional[str] = None):
    if evt not in ("view", "click", "impression"):
        evt = "view"
    with db() as c:
        c.execute(
            "INSERT INTO partner_events(key,evt,dest,ref,ip_hash,ua_hash,ts) VALUES (?,?,?,?,?,?,?)",
            (key, evt, dest, ref or request.headers.get("referer", ""),
             hash_ip(request.client.host if request.client else ""),
             hash_ua(request.headers.get("user-agent", "")), int(time.time()))
        )
    return Response(content=GIF_1x1, media_type="image/gif",
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate"})


@app.post("/api/widget/booking")
async def booking(request: Request,
                  x_impt_signature: Optional[str] = Header(None, alias="X-IMPT-Signature")):
    """
    HMAC-signed webhook. Verify with:
        sig = "sha256=" + hmac.new(secret, raw_body, sha256).hexdigest()

    Legacy: also accept body.secret for the first 7 days post-launch.
    """
    raw = await request.body()
    if len(raw) > 8192:
        raise HTTPException(413, "body too large")

    auth_ok = False
    if x_impt_signature:
        try:
            algo, hexsig = x_impt_signature.split("=", 1)
        except ValueError:
            raise HTTPException(400, "bad signature header")
        if algo.lower() != "sha256":
            raise HTTPException(400, "unsupported sig algo")
        expected = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, hexsig.lower()):
            auth_ok = True

    try:
        payload = json.loads(raw)
        body = BookingHookBody(**payload)
    except Exception:
        raise HTTPException(400, "bad json body")

    if not auth_ok:
        # Legacy fallback for first 7 days.
        if body.secret and hmac.compare_digest(body.secret, WEBHOOK_SECRET):
            auth_ok = True
        else:
            audit("webhook.bad_auth", subject=body.booking_id, detail=None,
                  ip_hash=hash_ip(request.client.host if request.client else ""))
            raise HTTPException(401, "bad signature")

    eur_cents = to_eur_cents(body.base_value, body.currency)
    accrual = int(eur_cents * COMMISSION_PCT)
    with db() as c:
        partner = c.execute("SELECT status FROM partners WHERE key=?", (body.partner_key,)).fetchone()
        if not partner:
            raise HTTPException(404, "unknown partner_key")
        if partner["status"] != "active":
            raise HTTPException(403, f"partner key not active (status={partner['status']})")
        try:
            c.execute(
                "INSERT INTO partner_bookings(partner_key,booking_id,base_value_cents,currency,accrual_eur_cents,status,booked_at,check_in_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (body.partner_key, body.booking_id, int(body.base_value * 100), body.currency.upper(),
                 accrual, "pending", body.booked_at or int(time.time()),
                 body.check_in_at, int(time.time()))
            )
        except sqlite3.IntegrityError:
            return {"ok": True, "duplicate": True}
    audit("booking.recorded", subject=body.booking_id,
          detail={"partner_key": body.partner_key, "accrual_eur_cents": accrual})
    return {"ok": True, "accrual_eur_cents": accrual, "commission_pct": COMMISSION_PCT}


@app.get("/api/widget/partners/me")
def me(authorization: str = Header(...)):
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer")
    token = authorization.split(" ", 1)[1].strip()
    with db() as c:
        partner = c.execute("SELECT key,email,name,payout_method,created_at,status FROM partners WHERE api_token=?", (token,)).fetchone()
        if not partner:
            raise HTTPException(401, "bad token")
        bookings = c.execute(
            "SELECT booking_id,base_value_cents,currency,accrual_eur_cents,status,booked_at,check_in_at FROM partner_bookings WHERE partner_key=? ORDER BY booked_at DESC LIMIT 100",
            (partner["key"],)
        ).fetchall()
        balance = c.execute(
            "SELECT COALESCE(SUM(accrual_eur_cents),0) AS bal FROM partner_bookings WHERE partner_key=? AND status IN ('pending','checked_in','payable')",
            (partner["key"],)
        ).fetchone()["bal"]
        clicks_30d = c.execute(
            "SELECT COUNT(*) AS n FROM partner_events WHERE key=? AND evt='click' AND ts > ?",
            (partner["key"], int(time.time()) - 30 * 86400)
        ).fetchone()["n"]
    return {
        "partner": dict(partner),
        "balance_eur_cents": balance,
        "clicks_30d": clicks_30d,
        "bookings": [dict(b) for b in bookings],
    }


# ── omnichannel additions (intents + hotels proxy + TG/WA/FB bots) ───
# Added 2026-05-09 by Claude end-to-end build.
import os as _os
import urllib.parse as _urlparse
import urllib.request as _urlreq
import urllib.error as _urlerr
from fastapi import Body
from fastapi.responses import PlainTextResponse

CITIES = [
    {"name":"Dublin","country":"IE","lat":53.3498,"lon":-6.2603,"currency":"EUR"},
    {"name":"Cork","country":"IE","lat":51.8985,"lon":-8.4756,"currency":"EUR"},
    {"name":"Galway","country":"IE","lat":53.2707,"lon":-9.0568,"currency":"EUR"},
    {"name":"Limerick","country":"IE","lat":52.6638,"lon":-8.6267,"currency":"EUR"},
    {"name":"Belfast","country":"GB","lat":54.5973,"lon":-5.9301,"currency":"GBP"},
    {"name":"London","country":"GB","lat":51.5074,"lon":-0.1278,"currency":"GBP"},
    {"name":"Edinburgh","country":"GB","lat":55.9533,"lon":-3.1883,"currency":"GBP"},
    {"name":"Manchester","country":"GB","lat":53.4808,"lon":-2.2426,"currency":"GBP"},
    {"name":"Paris","country":"FR","lat":48.8566,"lon":2.3522,"currency":"EUR"},
    {"name":"Barcelona","country":"ES","lat":41.3851,"lon":2.1734,"currency":"EUR"},
    {"name":"Madrid","country":"ES","lat":40.4168,"lon":-3.7038,"currency":"EUR"},
    {"name":"Rome","country":"IT","lat":41.9028,"lon":12.4964,"currency":"EUR"},
    {"name":"Milan","country":"IT","lat":45.4642,"lon":9.19,"currency":"EUR"},
    {"name":"Amsterdam","country":"NL","lat":52.3676,"lon":4.9041,"currency":"EUR"},
    {"name":"Berlin","country":"DE","lat":52.52,"lon":13.405,"currency":"EUR"},
    {"name":"Lisbon","country":"PT","lat":38.7223,"lon":-9.1393,"currency":"EUR"},
    {"name":"New York","country":"US","lat":40.7128,"lon":-74.006,"currency":"USD"},
    {"name":"Los Angeles","country":"US","lat":34.0522,"lon":-118.2437,"currency":"USD"},
    {"name":"Miami","country":"US","lat":25.7617,"lon":-80.1918,"currency":"USD"},
    {"name":"Tokyo","country":"JP","lat":35.6762,"lon":139.6503,"currency":"JPY"},
    {"name":"Singapore","country":"SG","lat":1.3521,"lon":103.8198,"currency":"SGD"},
    {"name":"Dubai","country":"AE","lat":25.2048,"lon":55.2708,"currency":"AED"},
    {"name":"Sydney","country":"AU","lat":-33.8688,"lon":151.2093,"currency":"AUD"},
    {"name":"Bangkok","country":"TH","lat":13.7563,"lon":100.5018,"currency":"THB"},
]
_CITY_BY_NAME = {c["name"].lower(): c for c in CITIES}

TG_BOT_TOKEN = _os.environ.get("TG_BOT_TOKEN", "")
TG_WEBHOOK_SECRET = _os.environ.get("TG_WEBHOOK_SECRET", "")
WA_PHONE_NUMBER_ID = _os.environ.get("WA_PHONE_NUMBER_ID", "")
WA_TOKEN = _os.environ.get("WA_TOKEN", "")
WA_VERIFY_TOKEN = _os.environ.get("WA_VERIFY_TOKEN", "")
FB_PAGE_ACCESS_TOKEN = _os.environ.get("FB_PAGE_ACCESS_TOKEN", "")
FB_VERIFY_TOKEN = _os.environ.get("FB_VERIFY_TOKEN", "")


def find_city(name):
    if not name:
        return None
    return _CITY_BY_NAME.get(name.strip().lower())


def init_omnichannel_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS intents (
          iid TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          channel TEXT NOT NULL,
          destination TEXT NOT NULL,
          campaign TEXT,
          creator TEXT,
          click_id TEXT,
          status TEXT NOT NULL DEFAULT 'created',
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_intents_key ON intents(key);
        CREATE INDEX IF NOT EXISTS idx_intents_ts ON intents(ts);
        CREATE TABLE IF NOT EXISTS bot_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel TEXT NOT NULL,
          chat_id TEXT,
          intent_iid TEXT,
          payload TEXT,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bot_events_ts ON bot_events(ts);
        CREATE INDEX IF NOT EXISTS idx_bot_events_channel ON bot_events(channel);
        """)


def new_iid():
    return "iid_" + secrets.token_urlsafe(9).replace("-", "X").replace("_", "Y")[:12]


def build_deeplink(iid, dest, key, channel, *, campaign="bot", creator=None, click_id=None):
    p = {}
    hit = find_city(dest)
    if hit:
        p["destination"] = hit["name"]
        p["locationName"] = hit["name"]
        p["tl"] = hit["country"].lower()
        p["gl"] = hit["country"].lower()
    elif dest:
        p["destination"] = dest
    # Idempotent prefix — accept "public" or "swarm-public", emit "swarm-public" once.
    norm_key = key[len("swarm-"):] if key.startswith("swarm-") else key
    p["utm_source"] = f"swarm-{norm_key}"
    p["utm_medium"] = channel
    p["utm_campaign"] = campaign
    p["utm_content"] = creator or "cream"
    p["iid"] = iid
    if click_id:
        p["click_id"] = click_id
    return f"{LANDER}?{_urlparse.urlencode(p)}"


def _persist_intent(iid, key, channel, dest, *, campaign="bot", creator=None, click_id=None):
    hit = find_city(dest)
    nice = hit["name"] if hit else dest
    with db() as c:
        c.execute(
            "INSERT OR REPLACE INTO intents(iid,key,channel,destination,campaign,creator,click_id,status,ts) VALUES (?,?,?,?,?,?,?,?,?)",
            (iid, key, channel, nice, campaign, creator, click_id, "created", int(time.time()))
        )
    return nice


# ── /api/widget/intent — JSON intent creation for adapters ──────────
@app.post("/api/widget/intent")
def widget_intent(payload: dict = Body(...)):
    dest = (payload.get("destination") or "").strip()
    if not dest:
        return JSONResponse({"error": "destination_required", "hint": "Pass a CITY (never country)."}, status_code=400)
    partner = payload.get("partner") or {}
    key = (partner.get("key") or "swarm-public")[:64]
    channel = (partner.get("channel") or "widget")[:32]
    campaign = (partner.get("campaign") or "oss")[:64]
    creator = (partner.get("creator") or None)
    click_id = (partner.get("click_id") or None)
    iid = new_iid()
    nice = _persist_intent(iid, key, channel, dest, campaign=campaign, creator=creator, click_id=click_id)
    deeplink = build_deeplink(iid, nice, key, channel, campaign=campaign, creator=creator, click_id=click_id)
    track_url = (
        f"{PUBLIC_BASE}/api/widget/track?key={_urlparse.quote(key)}"
        f"&evt=intent_created&channel={_urlparse.quote(channel)}"
        f"&dest={_urlparse.quote(nice)}&iid={iid}&ts={int(time.time()*1000)}"
    )
    embed = (
        f'<script src="https://swarm.impt.io/widget.js" data-key="{key}" data-dest="{nice}" async></script>'
        f'<div id="impt-swarm"></div>'
    )
    qr = f"{PUBLIC_BASE}/api/widget/qr/{_urlparse.quote(key)}.svg?dest={_urlparse.quote(nice)}&iid={iid}"
    return {"intent_id": iid, "deeplink": deeplink, "track": track_url, "embed": embed, "qr": qr}


# ── /api/widget/quote/{iid} — read intent ──────────────────────────
@app.get("/api/widget/quote/{iid}")
def widget_quote(iid: str):
    if not iid.startswith("iid_"):
        return JSONResponse({"error": "invalid_iid"}, status_code=400)
    with db() as c:
        row = c.execute("SELECT * FROM intents WHERE iid=?", (iid,)).fetchone()
    if not row:
        return JSONResponse({"error": "intent_not_found"}, status_code=404)
    rec = dict(row)
    hit = find_city(rec["destination"])
    deeplink = build_deeplink(rec["iid"], rec["destination"], rec["key"], rec["channel"],
                              campaign=rec.get("campaign") or "oss", creator=rec.get("creator"))
    return {
        "intent_id": rec["iid"],
        "status": rec["status"],
        "destination": rec["destination"],
        "currency": (hit or {}).get("currency", "USD"),
        "deeplink": deeplink,
        "ts": rec["ts"],
    }


# ── /api/widget/hotels — JSON hotel search proxy ───────────────────
@app.get("/api/widget/hotels")
def widget_hotels(city: str, key: str = "swarm-public", channel: str = "widget",
                  adults: int = 2, rooms: int = 1, limit: int = 10,
                  checkIn: Optional[str] = None, checkOut: Optional[str] = None,
                  currency: Optional[str] = None):
    hit = find_city(city)
    if not hit:
        return JSONResponse({"error": "unknown_city", "hint": "Add to CITIES list."}, status_code=400)
    from datetime import datetime, timedelta, timezone
    if not checkIn:
        checkIn = (datetime.now(timezone.utc) + timedelta(days=14)).date().isoformat()
    if not checkOut:
        checkOut = (datetime.now(timezone.utc) + timedelta(days=16)).date().isoformat()
    if not currency:
        currency = hit["currency"]
    adults = max(1, min(8, adults))
    rooms = max(1, min(4, rooms))
    limit = max(1, min(30, limit))
    upstream = (
        f"https://platform.impt.io/api/hotels?lat={hit['lat']}&lng={hit['lon']}"
        f"&checkIn={checkIn}&checkOut={checkOut}&adults={adults}&rooms={rooms}"
        f"&currency={_urlparse.quote(currency)}&page=1"
    )
    try:
        req = _urlreq.Request(upstream, headers={
            "accept": "application/json",
            "x-swarm-key": key,
            "x-swarm-channel": channel,
            "user-agent": "swarm-widget-proxy/0.2",
        })
        with _urlreq.urlopen(req, timeout=15) as r:
            raw = r.read()
            data = json.loads(raw)
    except _urlerr.HTTPError as e:
        return JSONResponse({"error": "upstream_error", "upstream_status": e.code}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": "upstream_unreachable", "detail": str(e)[:200]}, status_code=502)
    arr = data.get("data") if isinstance(data, dict) else None
    arr = arr if isinstance(arr, list) else []
    return {"city": hit["name"], "count": min(len(arr), limit), "hotels": arr[:limit], "cached": False}


# ── /api/widget/qr — real QR generator (segno) ─────────────────────
def _make_qr(target: str, fmt: str) -> tuple[bytes, str]:
    """Generate a real QR encoding `target` in cream/ink/lime palette."""
    import segno
    import io
    qr = segno.make(target, error="m")
    buf = io.BytesIO()
    if fmt == "svg":
        qr.save(buf, kind="svg", scale=8, dark="#08423a", light="#FAF7F0",
                border=2, finder_dark="#08423a", quiet_zone="#FAF7F0",
                xmldecl=True, svgns=True)
        return buf.getvalue(), "image/svg+xml"
    else:  # png
        qr.save(buf, kind="png", scale=10, dark="#08423a", light="#FAF7F0", border=2)
        return buf.getvalue(), "image/png"


@app.get("/api/widget/qr/{key}.svg")
def widget_qr_svg(key: str, dest: str = "Dublin", iid: Optional[str] = None):
    target = build_deeplink(iid or new_iid(), dest, key, "qr", campaign="qr")
    body, ct = _make_qr(target, "svg")
    return Response(body, media_type=ct, headers={
        "X-Target-URL": target,
        "Cache-Control": "public, max-age=300",
        "Content-Disposition": f'inline; filename="impt-{key}-{dest}.svg"',
    })


@app.get("/api/widget/qr/{key}.png")
def widget_qr_png(key: str, dest: str = "Dublin", iid: Optional[str] = None):
    target = build_deeplink(iid or new_iid(), dest, key, "qr", campaign="qr")
    body, ct = _make_qr(target, "png")
    return Response(body, media_type=ct, headers={
        "X-Target-URL": target,
        "Cache-Control": "public, max-age=300",
        "Content-Disposition": f'inline; filename="impt-{key}-{dest}.png"',
    })


# ── /api/email/sig/{key} — Gmail/Outlook-pasteable signature snippet ──
@app.get("/api/email/sig/{key}")
def email_signature(key: str, dest: str = "Dublin", style: str = "cream"):
    """Returns an HTML snippet partners paste into their email signature settings."""
    iid = new_iid()
    nice = _persist_intent(iid, key, "email", dest, campaign="signature")
    url = build_deeplink(iid, nice, key, "email", campaign="signature")
    # Outlook-safe inline HTML (no shadow-dom, no external CSS, no SVG positioning tricks).
    html = (
        f'<p style="margin:0;padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#08423a">'
        f'<span style="display:inline-block;background:#C8FF7E;color:#08423a;padding:3px 10px;border-radius:12px;'
        f'font-weight:bold;font-size:12px;margin-right:8px">🌱 IMPT</span>'
        f'<a href="{url}" target="_blank" style="color:#08423a;text-decoration:none">'
        f'Book green hotels in {nice}</a> — '
        f'<span style="color:#3a6b62">€5 free + 5% Goodness back · 1 tonne CO₂ offset per booking</span>'
        f'</p>'
    )
    text_fallback = f"Book green hotels — €5 free + 5% back: {url}"
    return {
        "html": html,
        "text": text_fallback,
        "url": url,
        "intent_id": iid,
        "instructions": {
            "gmail": "Settings → Signature → Insert and paste the HTML.",
            "outlook": "File → Options → Mail → Signatures → paste in the editor.",
            "apple_mail": "Mail → Settings → Signatures → drag-drop the HTML.",
        }
    }


# ── /api/gpt/openapi.json — ChatGPT Custom GPT Action manifest ─────
@app.get("/api/gpt/openapi.json")
def gpt_openapi():
    """OpenAPI 3.1 spec scoped for ChatGPT Custom GPT Action use.
    Single server, no auth, simple ops — ChatGPT renders it cleanly."""
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "IMPT — book green hotels",
            "description": "Search hotels and produce booking deeplinks via IMPT. Every booking offsets 1 tonne of CO₂ and gives the guest €5 free + 5% Goodness back. Adapter for ChatGPT Custom GPTs.",
            "version": "1.0.0",
        },
        "servers": [{"url": "https://swarm.impt.io"}],
        "paths": {
            "/api/widget/hotels": {
                "get": {
                    "operationId": "searchHotels",
                    "summary": "Search hotels in a city",
                    "parameters": [
                        {"name": "city", "in": "query", "required": True,
                         "schema": {"type": "string"},
                         "description": "City name (never country). Examples: Dublin, Paris, Tokyo."},
                        {"name": "adults", "in": "query", "schema": {"type": "integer", "default": 2}},
                        {"name": "rooms", "in": "query", "schema": {"type": "integer", "default": 1}},
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 5}},
                        {"name": "key", "in": "query", "schema": {"type": "string", "default": "swarm-gpt"}},
                        {"name": "channel", "in": "query", "schema": {"type": "string", "default": "gpt"}},
                    ],
                    "responses": {"200": {"description": "List of hotels"}},
                }
            },
            "/api/widget/intent": {
                "post": {
                    "operationId": "createBookingDeeplink",
                    "summary": "Create a booking intent + canonical deeplink",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "required": ["destination", "partner"],
                            "properties": {
                                "destination": {"type": "string", "description": "City name"},
                                "partner": {"type": "object", "properties": {
                                    "key": {"type": "string", "default": "swarm-gpt"},
                                    "channel": {"type": "string", "default": "gpt"},
                                }},
                            }
                        }}}
                    },
                    "responses": {"200": {"description": "Returns deeplink + intent_id"}},
                }
            },
            "/api/widget/quote/{iid}": {
                "get": {
                    "operationId": "getQuote",
                    "summary": "Look up a previously-created intent by iid",
                    "parameters": [{"name": "iid", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "responses": {"200": {"description": "Intent record + deeplink"}},
                }
            },
        },
    }


# ── /api/mcp — Model Context Protocol HTTP transport (Claude/ChatGPT/etc.) ──
# Minimal MCP HTTP transport. Single POST endpoint accepts JSON-RPC 2.0 requests
# for: initialize, tools/list, tools/call. Bidirectional SSE not implemented —
# stateless request/response is sufficient for our four hotel-booking tools.
MCP_TOOLS = [
    {
        "name": "impt_search_hotels",
        "description": "Search IMPT hotels in a city. Returns up to 10 hotels with prices, photos, room types. Books with €5 free + 5% Goodness back + 1 tonne CO₂ offset per booking.",
        "inputSchema": {
            "type": "object",
            "required": ["city"],
            "properties": {
                "city": {"type": "string", "description": "City name (Dublin, Paris, Tokyo, etc). Never use a country."},
                "adults": {"type": "integer", "default": 2, "minimum": 1, "maximum": 8},
                "rooms": {"type": "integer", "default": 1, "minimum": 1, "maximum": 4},
                "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 30},
            },
        },
    },
    {
        "name": "impt_create_intent",
        "description": "Create a booking intent and return a canonical deeplink the user can open to complete payment on app.impt.io. Use this when the user has settled on a city.",
        "inputSchema": {
            "type": "object",
            "required": ["destination"],
            "properties": {
                "destination": {"type": "string", "description": "City name"},
                "partner_key": {"type": "string", "default": "swarm-mcp"},
            },
        },
    },
    {
        "name": "impt_get_quote",
        "description": "Look up a previously-created intent by intent_id (iid_*) — returns the destination + deeplink + status.",
        "inputSchema": {
            "type": "object",
            "required": ["intent_id"],
            "properties": {"intent_id": {"type": "string", "description": "iid_* identifier returned by impt_create_intent"}},
        },
    },
    {
        "name": "impt_get_deeplink",
        "description": "Synthesize a find-hotel-input deeplink without persisting an intent. Useful for previews or when the user just wants a URL to share.",
        "inputSchema": {
            "type": "object",
            "required": ["destination"],
            "properties": {
                "destination": {"type": "string"},
                "partner_key": {"type": "string", "default": "swarm-mcp"},
            },
        },
    },
]


def _mcp_tool_call(name: str, args: dict):
    """Run a tool synchronously and return MCP content array."""
    try:
        if name == "impt_search_hotels":
            city = args.get("city", "")
            hit = find_city(city)
            if not hit:
                return [{"type": "text", "text": f"City '{city}' not in supported list. Try Dublin, Paris, Tokyo, etc."}]
            from datetime import datetime, timedelta, timezone
            ci = (datetime.now(timezone.utc) + timedelta(days=14)).date().isoformat()
            co = (datetime.now(timezone.utc) + timedelta(days=16)).date().isoformat()
            url = (f"https://platform.impt.io/api/hotels?lat={hit['lat']}&lng={hit['lon']}"
                   f"&checkIn={ci}&checkOut={co}&adults={int(args.get('adults', 2))}"
                   f"&rooms={int(args.get('rooms', 1))}&currency={hit['currency']}&page=1")
            try:
                with _urlreq.urlopen(url, timeout=15) as r:
                    data = json.loads(r.read())
            except Exception as e:
                return [{"type": "text", "text": f"Hotel search failed: {e}"}]
            arr = data.get("data") if isinstance(data, dict) else None
            arr = arr if isinstance(arr, list) else []
            limit = max(1, min(30, int(args.get("limit", 10))))
            arr = arr[:limit]
            summary = f"Found {len(arr)} hotels in {hit['name']} ({ci} → {co}, {hit['currency']}):"
            lines = [summary]
            for h in arr[:10]:
                name = h.get("hotelName") or h.get("name") or "Hotel"
                price = h.get("totalPrice") or h.get("price")
                stars = h.get("starRating") or h.get("stars")
                lines.append(f"• {name} — {stars}★ — {hit['currency']} {price}")
            return [{"type": "text", "text": "\n".join(lines)}]
        if name == "impt_create_intent":
            dest = args.get("destination", "")
            key = args.get("partner_key") or "swarm-mcp"
            iid = new_iid()
            nice = _persist_intent(iid, key, "mcp", dest, campaign="mcp")
            url = build_deeplink(iid, nice, key, "mcp", campaign="mcp")
            return [{"type": "text",
                     "text": f"Intent created.\nIntent ID: {iid}\nDestination: {nice}\nDeeplink: {url}\n\nThe user opens this URL to book. €5 free + 5% Goodness back + 1 tonne CO₂ offset."}]
        if name == "impt_get_quote":
            iid = args.get("intent_id", "")
            if not iid.startswith("iid_"):
                return [{"type": "text", "text": "Invalid intent_id (expected iid_*)."}]
            with db() as c:
                row = c.execute("SELECT * FROM intents WHERE iid=?", (iid,)).fetchone()
            if not row:
                return [{"type": "text", "text": f"Intent {iid} not found."}]
            rec = dict(row)
            url = build_deeplink(iid, rec["destination"], rec["key"], rec["channel"],
                                 campaign=rec.get("campaign") or "oss")
            return [{"type": "text", "text":
                     f"Intent {iid}\nDestination: {rec['destination']}\nStatus: {rec['status']}\nChannel: {rec['channel']}\nDeeplink: {url}"}]
        if name == "impt_get_deeplink":
            dest = args.get("destination", "")
            key = args.get("partner_key") or "swarm-mcp"
            url = build_deeplink(new_iid(), dest, key, "mcp", campaign="mcp")
            return [{"type": "text", "text": f"Deeplink: {url}"}]
        return [{"type": "text", "text": f"Unknown tool: {name}"}]
    except Exception as e:
        return [{"type": "text", "text": f"Tool error: {e}"}]


@app.post("/api/mcp/http")
async def mcp_http(request: Request):
    """MCP Streamable HTTP transport (single endpoint, JSON-RPC 2.0)."""
    try:
        msg = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "error": {"code": -32700, "message": "parse error"}, "id": None}, status_code=400)
    method = msg.get("method", "")
    rpc_id = msg.get("id")
    params = msg.get("params") or {}
    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": rpc_id,
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "impt-swarm-widget", "version": "0.2.0"},
                "instructions": "IMPT booking adapter. Use impt_search_hotels then impt_create_intent. Always pass a CITY (never a country). Currency is destination-driven.",
            }
        }
    if method == "notifications/initialized":
        return Response(status_code=204)
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rpc_id, "result": {"tools": MCP_TOOLS}}
    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments") or {}
        content = _mcp_tool_call(name, args)
        return {"jsonrpc": "2.0", "id": rpc_id, "result": {"content": content, "isError": False}}
    return {"jsonrpc": "2.0", "id": rpc_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"}}


@app.get("/api/mcp/info")
def mcp_info():
    """Human-readable MCP server info — pasteable into Claude Desktop config."""
    return {
        "name": "impt-swarm-widget",
        "version": "0.2.0",
        "transport": "http",
        "endpoint": f"{PUBLIC_BASE}/api/mcp/http",
        "tools": [t["name"] for t in MCP_TOOLS],
        "claude_desktop_config": {
            "mcpServers": {
                "impt": {"url": f"{PUBLIC_BASE}/api/mcp/http"}
            }
        },
        "claude_code_install": f"claude mcp add impt --transport http --url {PUBLIC_BASE}/api/mcp/http",
    }


# ── Telegram bot webhook ────────────────────────────────────────────
def tg_send(method: str, payload: dict):
    if not TG_BOT_TOKEN:
        return None
    try:
        req = _urlreq.Request(
            f"https://api.telegram.org/bot{TG_BOT_TOKEN}/{method}",
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json"},
        )
        with _urlreq.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[tg_send] {method} failed: {e}", flush=True)
        return None


def tg_reply_city_picker(chat_id: int, greet: bool = True):
    top = CITIES[:12]
    rows = []
    for i in range(0, len(top), 3):
        rows.append([{"text": c["name"], "callback_data": f"c:{c['name']}"} for c in top[i:i + 3]])
    text = (
        "🌱 *IMPT — book hotels with conscience*\n\n"
        "€5 free credit · 5% Goodness back · 1 tonne CO₂ offset per booking.\n\n"
        "Pick a city or type one:"
    ) if greet else "Pick a city or type one:"
    tg_send("sendMessage", {
        "chat_id": chat_id, "text": text, "parse_mode": "Markdown",
        "reply_markup": {"inline_keyboard": rows}
    })


def tg_reply_book_cta(chat_id: int, city: str, key: str = "swarm-public"):
    iid = new_iid()
    nice = _persist_intent(iid, key, "tg", city, campaign="bot")
    url = build_deeplink(iid, nice, key, "tg", campaign="bot")
    hit = find_city(nice)
    ccy = (hit or {}).get("currency", "USD")
    tg_send("sendMessage", {
        "chat_id": chat_id,
        "text": f"*{nice}* — {ccy} prices, free cancellation on most hotels, 1 tonne CO₂ offset per booking (we pay).\n\nTap to see hotels and reserve. €5 free credit applied at checkout.",
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
        "reply_markup": {"inline_keyboard": [
            [{"text": f"🔎 Find hotels in {nice} →", "url": url}],
            [{"text": "↩ Pick another city", "callback_data": "restart"}],
        ]},
    })


def tg_reply_help(chat_id: int):
    tg_send("sendMessage", {
        "chat_id": chat_id,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
        "text": (
            "*How this works*\n\n"
            "1. Pick a city (button) or type one (e.g. \"Dublin\")\n"
            "2. Tap *Find hotels* — opens the IMPT booking page with your city pre-filled\n"
            "3. Pick dates, browse hotels, reserve, pay\n\n"
            "*What you get*\n"
            "• €5 free credit on signup\n"
            "• 5% Goodness back per booking (3% to a cause + 2% next-stay credit)\n"
            "• 1 tonne CO₂ offset per booking (paid by IMPT)\n\n"
            "*Commands*\n/start · /book <city> · /city <name> · /help"
        )
    })


@app.post("/api/tg/webhook")
async def tg_webhook(request: Request):
    if TG_WEBHOOK_SECRET:
        got = request.headers.get("x-telegram-bot-api-secret-token", "")
        if got != TG_WEBHOOK_SECRET:
            raise HTTPException(status_code=403, detail="forbidden")
    if not TG_BOT_TOKEN:
        return JSONResponse({"error": "tg_bot_token_unset"}, status_code=503)
    try:
        update = await request.json()
    except Exception:
        return Response("ok")
    with db() as c:
        c.execute(
            "INSERT INTO bot_events(channel,chat_id,intent_iid,payload,ts) VALUES (?,?,?,?,?)",
            ("tg", str((update.get("message") or update.get("callback_query") or {}).get("from", {}).get("id", "")),
             None, json.dumps(update)[:4000], int(time.time()))
        )
    cq = update.get("callback_query")
    if cq:
        chat_id = (cq.get("message") or {}).get("chat", {}).get("id") or cq["from"]["id"]
        tg_send("answerCallbackQuery", {"callback_query_id": cq["id"]})
        data = cq.get("data") or ""
        if data == "restart":
            tg_reply_city_picker(int(chat_id), greet=False)
        elif data.startswith("c:"):
            tg_reply_book_cta(int(chat_id), data[2:])
        return Response("ok")
    msg = update.get("message")
    if not msg:
        return Response("ok")
    chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    if text.startswith("/"):
        head = text.split(" ", 1)
        cmd = head[0][1:].split("@")[0].lower()
        args = head[1].strip() if len(head) > 1 else ""
        if cmd in ("start", "book", "city"):
            if args:
                tg_reply_book_cta(chat_id, args)
            else:
                tg_reply_city_picker(chat_id, greet=True)
        elif cmd == "help":
            tg_reply_help(chat_id)
        else:
            tg_reply_help(chat_id)
        return Response("ok")
    if text:
        # Strip leading verbs ("book Dublin" → "Dublin")
        cleaned = re.sub(r"^(book|find|hotel|hotels|stay|travel)\s+", "", text, flags=re.IGNORECASE).strip()
        # Real-city heuristic: ≤3 words, each alpha-only ≤15 chars, **first word capitalised**
        # (cities are proper nouns), no punctuation chaos.
        # Accepted: "Dublin", "New York", "Rio de Janeiro", "São Paulo".
        # Rejected: "hello there how are you", "Rambo? 😂", "what is this", "yes please".
        words = cleaned.split()
        looks_like_city = (
            bool(cleaned) and len(cleaned) >= 3 and len(cleaned) <= 40
            and 1 <= len(words) <= 3
            and all(re.match(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-']{0,14}$", w) for w in words)
            and words[0][0].isupper()  # proper noun rule
        )
        if find_city(cleaned) or looks_like_city:
            tg_reply_book_cta(chat_id, cleaned)
        else:
            tg_send("sendMessage", {
                "chat_id": chat_id,
                "text": "I'm a hotel-booking bot 🌱 — type a *city* (e.g. \"Dublin\", \"Paris\", \"Tokyo\") or pick one below.",
                "parse_mode": "Markdown",
            })
            tg_reply_city_picker(chat_id, greet=False)
    else:
        tg_reply_city_picker(chat_id, greet=True)
    return Response("ok")


# ── WhatsApp Cloud API webhook ──────────────────────────────────────
GRAPH = "https://graph.facebook.com/v19.0"


def wa_post(path: str, body: dict):
    if not WA_TOKEN or not WA_PHONE_NUMBER_ID:
        return None
    try:
        req = _urlreq.Request(
            f"{GRAPH}/{path}",
            data=json.dumps(body).encode(),
            headers={"authorization": f"Bearer {WA_TOKEN}", "content-type": "application/json"},
        )
        with _urlreq.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[wa] post failed: {e}", flush=True)
        return None


@app.get("/api/whatsapp/webhook")
def wa_verify(request: Request):
    qs = dict(request.query_params)
    if (qs.get("hub.mode") == "subscribe"
        and WA_VERIFY_TOKEN
        and qs.get("hub.verify_token") == WA_VERIFY_TOKEN
        and qs.get("hub.challenge")):
        return PlainTextResponse(qs["hub.challenge"])
    raise HTTPException(status_code=403, detail="forbidden")


@app.post("/api/whatsapp/webhook")
async def wa_webhook(request: Request):
    if not WA_TOKEN or not WA_PHONE_NUMBER_ID:
        return {"ok": True, "note": "wa_not_provisioned"}
    try:
        body = await request.json()
    except Exception:
        return Response("ok")
    with db() as c:
        c.execute(
            "INSERT INTO bot_events(channel,chat_id,intent_iid,payload,ts) VALUES (?,?,?,?,?)",
            ("wa", "", None, json.dumps(body)[:4000], int(time.time()))
        )
    entries = body.get("entry") or []
    for ent in entries:
        for change in (ent.get("changes") or []):
            v = (change or {}).get("value") or {}
            for m in (v.get("messages") or []):
                frm = m.get("from")
                txt = ""
                if m.get("type") == "text":
                    txt = (m.get("text") or {}).get("body", "").strip()
                elif m.get("type") == "interactive":
                    inter = m.get("interactive") or {}
                    txt = (inter.get("button_reply") or inter.get("list_reply") or {}).get("title", "").strip()
                if not txt:
                    wa_post(f"{WA_PHONE_NUMBER_ID}/messages", {
                        "messaging_product": "whatsapp", "to": frm, "type": "text",
                        "text": {"body": "Hi 👋 — type a city (e.g. \"Dublin\") and I'll send you a one-tap booking link. €5 free + 5% Goodness back."}
                    })
                    continue
                cleaned = re.sub(r"^(book|find|hotel|hotels|stay)\s+", "", txt, flags=re.IGNORECASE).strip() or txt
                iid = new_iid()
                nice = _persist_intent(iid, "swarm-public", "wa", cleaned, campaign="bot")
                url = build_deeplink(iid, nice, "swarm-public", "wa", campaign="bot")
                hit = find_city(nice)
                ccy = (hit or {}).get("currency", "USD")
                wa_post(f"{WA_PHONE_NUMBER_ID}/messages", {
                    "messaging_product": "whatsapp", "to": frm, "type": "interactive",
                    "interactive": {
                        "type": "cta_url",
                        "body": {"text": f"*{nice}* — book a hotel in {ccy}.\n€5 free + 5% Goodness back · 1 tonne CO₂ offset per booking (we pay)."},
                        "action": {"name": "cta_url", "parameters": {"display_text": f"Find hotels in {nice}", "url": url}},
                    }
                })
    return Response("ok")


# ── Facebook Messenger Platform webhook ─────────────────────────────
def fb_send(recipient_id: str, payload: dict):
    if not FB_PAGE_ACCESS_TOKEN:
        return None
    try:
        req = _urlreq.Request(
            f"{GRAPH}/me/messages?access_token={_urlparse.quote(FB_PAGE_ACCESS_TOKEN)}",
            data=json.dumps({"recipient": {"id": recipient_id}, "messaging_type": "RESPONSE", **payload}).encode(),
            headers={"content-type": "application/json"},
        )
        with _urlreq.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[fb] send failed: {e}", flush=True)
        return None


def fb_quick_reply_picker(to: str):
    cities = ["Dublin", "London", "Paris", "Barcelona", "Rome", "New York", "Tokyo", "Dubai"]
    fb_send(to, {"message": {
        "text": "Pick a city — or type one:",
        "quick_replies": [{"content_type": "text", "title": c, "payload": f"CITY:{c}"} for c in cities]
    }})


def fb_card_for_city(to: str, city: str, key: str = "swarm-public"):
    iid = new_iid()
    nice = _persist_intent(iid, key, "fb", city, campaign="messenger")
    url = build_deeplink(iid, nice, key, "fb", campaign="messenger")
    fb_send(to, {"message": {"attachment": {
        "type": "template",
        "payload": {"template_type": "generic", "elements": [{
            "title": f"{nice} — find a green hotel",
            "subtitle": "€5 free credit · 5% Goodness back · 1 tonne CO₂ offset per booking (we pay).",
            "buttons": [
                {"type": "web_url", "url": url, "title": f"Find hotels in {nice} →"},
                {"type": "postback", "title": "Pick another city", "payload": "RESTART"},
            ]
        }]}
    }}})


@app.get("/api/fb/webhook")
def fb_verify(request: Request):
    qs = dict(request.query_params)
    if (qs.get("hub.mode") == "subscribe"
        and FB_VERIFY_TOKEN
        and qs.get("hub.verify_token") == FB_VERIFY_TOKEN
        and qs.get("hub.challenge")):
        return PlainTextResponse(qs["hub.challenge"])
    raise HTTPException(status_code=403, detail="forbidden")


@app.post("/api/fb/webhook")
async def fb_webhook(request: Request):
    if not FB_PAGE_ACCESS_TOKEN:
        return {"ok": True, "note": "fb_not_provisioned"}
    try:
        body = await request.json()
    except Exception:
        return Response("ok")
    with db() as c:
        c.execute(
            "INSERT INTO bot_events(channel,chat_id,intent_iid,payload,ts) VALUES (?,?,?,?,?)",
            ("fb", "", None, json.dumps(body)[:4000], int(time.time()))
        )
    for ent in (body.get("entry") or []):
        for ev in (ent.get("messaging") or []):
            sender = (ev.get("sender") or {}).get("id")
            if not sender:
                continue
            if ev.get("postback"):
                p = ev["postback"].get("payload", "")
                if p == "RESTART":
                    fb_quick_reply_picker(sender)
                elif p.startswith("CITY:"):
                    fb_card_for_city(sender, p[5:])
                continue
            qr = (ev.get("message") or {}).get("quick_reply", {}).get("payload", "")
            if qr.startswith("CITY:"):
                fb_card_for_city(sender, qr[5:])
                continue
            txt = ((ev.get("message") or {}).get("text") or "").strip()
            if not txt:
                fb_quick_reply_picker(sender)
                continue
            cleaned = re.sub(r"^(book|find|hotel|hotels|stay)\s+", "", txt, flags=re.IGNORECASE).strip() or txt
            fb_card_for_city(sender, cleaned)
    return Response("ok")


init_db()
init_omnichannel_db()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=2027)
