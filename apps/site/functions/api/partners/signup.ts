/**
 * POST /api/partners/signup
 *
 * Self-serve partner sign-up — issues a partner key, sends a welcome email.
 *
 * Body: { email, brand, payout: 'wise' | 'paypal' | 'stripe' | 'impt-card' | 'impt-token' }
 * Response: { key: 'prt_<8>', dashboard: '/partners?key=...' }
 *
 * Per-memory rule: welcome emails to PARTNERS are a deliberate exception to the
 * "drafts to mike@ only" rule (they sign up + opt in). Mike + Lorna + solicitors
 * stay gated behind explicit per-item approval.
 */

import { json, badRequest, preflight } from '../../_lib/json.js';
import { kvPut, kvGet, type Bindings } from '../../_lib/kv.js';
import { newPartnerKey } from '../../_lib/keys.js';
import { sendEmail } from '../../_lib/sendgrid.js';

interface SignupBody {
  email?: string;
  brand?: string;
  payout?: string;
}

interface PartnerRecord {
  key: string;
  email: string;
  brand: string;
  payout: string;
  created_at: number;
  status: 'active' | 'suspended';
  cf_country?: string | null;
}

interface Env extends Bindings {
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
}

const VALID_PAYOUTS = ['wise', 'paypal', 'stripe', 'impt-card', 'impt-token'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: SignupBody;
  try {
    body = await ctx.request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const email = body.email?.trim().toLowerCase();
  const brand = body.brand?.trim();
  const payout = body.payout?.trim();

  if (!email || !brand || !payout) return badRequest('email_brand_payout_required');
  if (!EMAIL_RE.test(email)) return badRequest('invalid_email');
  if (!VALID_PAYOUTS.includes(payout)) {
    return badRequest('invalid_payout', `Pick one of: ${VALID_PAYOUTS.join(', ')}.`);
  }

  // Reuse existing key if email already signed up (idempotent).
  const existing = await kvGet<PartnerRecord>(ctx.env.PARTNERS, `email:${email}`);
  if (existing) {
    return json({ key: existing.key, dashboard: `/partners?key=${existing.key}`, reused: true });
  }

  const key = newPartnerKey();
  const cf = (ctx.request as Request & { cf?: { country?: string } }).cf;
  const record: PartnerRecord = {
    key,
    email,
    brand,
    payout,
    created_at: Date.now(),
    status: 'active',
    cf_country: cf?.country ?? null
  };

  // Two indexes: by-key for dashboard reads, by-email for idempotency.
  ctx.waitUntil(kvPut(ctx.env.PARTNERS, `key:${key}`, record, { ttlDays: 365 * 5 }));
  ctx.waitUntil(kvPut(ctx.env.PARTNERS, `email:${email}`, record, { ttlDays: 365 * 5 }));

  // Welcome email — fire-and-forget so the sign-up returns fast.
  ctx.waitUntil(sendWelcome(ctx.env, record));

  return json({ key, dashboard: `/partners?key=${key}` }, 201);
};

async function sendWelcome(env: Env, record: PartnerRecord): Promise<void> {
  const html = `
    <p>Hi,</p>
    <p>Your IMPT Swarm partner key is <strong><code style="background:#FAF7F0;padding:2px 6px;border-radius:4px">${record.key}</code></strong>.</p>
    <p>Drop the widget on your site:</p>
    <pre style="background:#08423a;color:#cfe;padding:12px;border-radius:8px;overflow-x:auto">&lt;script src="https://swarm.impt.io/widget.js" data-key="${record.key}" async&gt;&lt;/script&gt;
&lt;div id="impt-swarm"&gt;&lt;/div&gt;</pre>
    <p>Or share a per-channel link — same key works everywhere:</p>
    <ul>
      <li>Telegram: <a href="https://swarm.impt.io/tg?key=${record.key}">swarm.impt.io/tg?key=${record.key}</a></li>
      <li>WhatsApp: <a href="https://swarm.impt.io/wa?key=${record.key}">swarm.impt.io/wa?key=${record.key}</a></li>
      <li>Instagram: <a href="https://swarm.impt.io/ig?key=${record.key}">swarm.impt.io/ig?key=${record.key}</a></li>
      <li>QR codes: <a href="https://swarm.impt.io/qr?key=${record.key}">swarm.impt.io/qr?key=${record.key}</a></li>
      <li>Full list: <a href="https://swarm.impt.io">swarm.impt.io</a></li>
    </ul>
    <p>You earn <strong>5%</strong> on every confirmed booking, with a <strong>90-day attribution cookie</strong>. Your guests get <strong>€5 free + 5% Goodness back</strong> (3% to a cause, 2% next-stay credit) and one tonne of CO₂ offset per booking — paid by IMPT, not deducted from you.</p>
    <p>Dashboard: <a href="https://swarm.impt.io/partners?key=${record.key}">swarm.impt.io/partners?key=${record.key}</a></p>
    <p>— The IMPT team<br><span style="color:#3a6b62;font-size:13px">Made in Ireland · <a href="https://impt.io" style="color:#3a6b62">impt.io</a></span></p>
  `;
  await sendEmail(env, {
    to: record.email,
    subject: 'Your IMPT Swarm partner key',
    html
  });
}

export const onRequestOptions: PagesFunction = async () => preflight();
