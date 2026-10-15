/**
 * Cloudflare Pages Function: proxies /api/* to the API on Render so the browser sees ONE origin.
 * Benefits: first-party refresh cookies (no third-party cookie blocking), no CORS, and the API
 * receives the real visitor IP (needed for office-network restrictions) via a trusted header.
 *
 * Pages environment variables: API_ORIGIN (e.g. https://attendance-api.onrender.com), PROXY_SECRET.
 */
interface Env {
  API_ORIGIN: string;
  PROXY_SECRET: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);

  const headers = new Headers(request.headers);
  headers.set('x-client-ip', request.headers.get('cf-connecting-ip') ?? '');
  headers.set('x-proxy-secret', env.PROXY_SECRET);
  headers.set('x-forwarded-host', url.host);
  headers.delete('host');

  const init: RequestInit = {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  };
  try {
    return await fetch(target.toString(), init);
  } catch {
    return new Response(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The server is starting up. Please try again in a moment.' } }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '10' },
    });
  }
};
