/**
 * Cloudflare Worker: proxies /api/* to the API on Render so the browser sees ONE origin.
 * Benefits: first-party refresh cookies (no third-party cookie blocking), no CORS, and the API
 * receives the real visitor IP (needed for office-network restrictions) via a trusted header.
 * Every other path is served from the static build (see wrangler.jsonc), never reaching this code.
 *
 * Variables: API_ORIGIN (wrangler.jsonc), PROXY_SECRET (Cloudflare dashboard secret).
 */
interface Env {
  API_ORIGIN: string;
  PROXY_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return new Response(
        JSON.stringify({
          error: {
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'The server is starting up. Please try again in a moment.',
          },
        }),
        {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '10' },
        },
      );
    }
  },
};
