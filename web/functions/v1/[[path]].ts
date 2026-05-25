type Env = {
  HEYVERA_API_ORIGIN?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
};

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeOrigin(configuredOrigin: string): URL {
  const upstreamOrigin = new URL(configuredOrigin);
  if (upstreamOrigin.protocol !== "https:" && upstreamOrigin.protocol !== "http:") {
    throw new Error("unsupported upstream protocol");
  }
  upstreamOrigin.hash = "";
  upstreamOrigin.search = "";
  upstreamOrigin.pathname = upstreamOrigin.pathname.replace(/\/+$/, "");
  return upstreamOrigin;
}

function buildUpstreamUrl(incomingUrl: URL, configuredOrigin: string): URL {
  const upstreamUrl = normalizeOrigin(configuredOrigin);
  const basePath = upstreamUrl.pathname;
  upstreamUrl.pathname = `${basePath}${incomingUrl.pathname}`.replace(/\/{2,}/g, "/");
  upstreamUrl.search = incomingUrl.search;
  return upstreamUrl;
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  const configuredOrigin = env.HEYVERA_API_ORIGIN?.trim();
  if (!configuredOrigin) {
    return json(503, {
      error: "missing_upstream",
      message: "HEYVERA_API_ORIGIN is not configured for the HeyVera Pages /v1 proxy.",
    });
  }

  const incomingUrl = new URL(request.url);
  let upstreamUrl: URL;

  try {
    upstreamUrl = buildUpstreamUrl(incomingUrl, configuredOrigin);
  } catch {
    return json(500, {
      error: "invalid_upstream",
      message: "HEYVERA_API_ORIGIN must be an http(s) origin.",
    });
  }

  if (upstreamUrl.hostname === incomingUrl.hostname) {
    return json(500, {
      error: "invalid_upstream",
      message: "HEYVERA_API_ORIGIN must not point back at heyvera.org.",
    });
  }

  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  headers.delete("host");
  headers.set("X-Forwarded-Host", incomingUrl.host);
  headers.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));

  const init: RequestInit = {
    headers,
    method: request.method,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  return fetch(upstreamUrl.toString(), init);
}
