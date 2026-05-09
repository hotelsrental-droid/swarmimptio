/**
 * GET /api/widget/hotels?city=… JSON hotel search — proxied to app.impt.io internal API.
 *
 * P0.5 — wired to Mongo + Stripe in the next PR. Today this returns 501 with a stable
 * error shape so adapters can be tested against the contract.
 */

interface Env {}

const handler: PagesFunction<Env> = async () =>
  new Response(JSON.stringify({ error: 'not_implemented', phase: 'P0.5', see: 'https://swarm.impt.io/openapi.json' }), {
    status: 501,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*'
    }
  });

export const onRequest = handler;
