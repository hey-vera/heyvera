export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const upstream = `https://api.heyvera.org${url.pathname}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.set('X-Forwarded-Host', url.hostname);

  const response = await fetch(upstream, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  });

  const proxyHeaders = new Headers(response.headers);
  proxyHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: proxyHeaders,
  });
};
