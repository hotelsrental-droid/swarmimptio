/**
 * POST /api/partners/signup
 *
 * Self-serve partner sign-up — issues a partner key.
 *
 * Body: { email, brand, payout: 'wise' | 'paypal' | 'stripe' | 'impt-card' | 'impt-token' }
 * Response: { key: 'prt_<short>', dashboard: '/partners?key=...' }
 *
 * P0.5 — wired to KV (key store) + welcome email via Sendgrid. Today returns 501
 * with a clear "email partners@impt.io" fallback so the form is honest.
 */

interface Env {
  PARTNERS?: KVNamespace;
}

interface SignupBody {
  email?: string;
  brand?: string;
  payout?: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: SignupBody;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.email || !body.brand || !body.payout) {
    return json({ error: 'email_brand_payout_required' }, 400);
  }
  return json(
    {
      error: 'not_implemented',
      phase: 'P0.5',
      fallback: 'Email partners@impt.io to be onboarded by hand — we will issue a key within 24h.'
    },
    501
  );
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*'
    }
  });
}
