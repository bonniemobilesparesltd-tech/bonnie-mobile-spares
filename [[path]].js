export async function onRequest(context) {
  const { request, env } = context;

  if (!env.BACKEND_WORKER_URL) {
    return new Response(JSON.stringify({
      error: "Booking API is not configured yet."
    }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const incoming = new URL(request.url);
  const backendBase = env.BACKEND_WORKER_URL.replace(/\/+$/, "");
  const target = `${backendBase}${incoming.pathname}${incoming.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "follow"
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("access-control-allow-origin");
  responseHeaders.delete("access-control-allow-methods");
  responseHeaders.delete("access-control-allow-headers");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
