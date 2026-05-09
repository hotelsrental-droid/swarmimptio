/**
 * Shared response helpers for Pages Functions.
 * Keep responses CORS-open + content-type-correct.
 */

const baseHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...baseHeaders, ...extra }
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: baseHeaders });
}

export function badRequest(error: string, hint?: string): Response {
  return json({ error, ...(hint ? { hint } : {}) }, 400);
}

export function notFound(error = 'not_found'): Response {
  return json({ error }, 404);
}

export function notImplemented(phase: string, fallback?: string): Response {
  return json({ error: 'not_implemented', phase, ...(fallback ? { fallback } : {}) }, 501);
}
