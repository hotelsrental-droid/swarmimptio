/**
 * Minimal Sendgrid HTTP client for Pages Functions.
 *
 * Uses the public Sendgrid v3 API — no SDK, no Node dependencies, fetch-only.
 * Reads SENDGRID_API_KEY + SENDGRID_FROM_EMAIL from CF Pages env.
 *
 * Memory rule: NEVER auto-send to anyone but mike@. Welcome emails to PARTNERS are
 * a deliberate exception (they sign-up + opt in). Mike + Lorna + solicitors are
 * still gated behind explicit per-item approval.
 */

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
}

interface Env {
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
}

export async function sendEmail(env: Env, input: SendInput): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM_EMAIL) {
    return { ok: false, error: 'sendgrid_not_configured' };
  }

  const body = {
    personalizations: [{ to: [{ email: input.to }], subject: input.subject }],
    from: {
      email: env.SENDGRID_FROM_EMAIL,
      name: env.SENDGRID_FROM_NAME ?? 'IMPT Swarm'
    },
    ...(input.reply_to ? { reply_to: { email: input.reply_to } } : {}),
    content: [
      { type: 'text/plain', value: input.text ?? input.html.replace(/<[^>]+>/g, '') },
      { type: 'text/html', value: input.html }
    ]
  };

  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (r.status === 202) return { ok: true, status: 202 };
  const text = await r.text().catch(() => '');
  return { ok: false, status: r.status, error: text.slice(0, 500) };
}
