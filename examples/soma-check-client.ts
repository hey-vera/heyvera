/**
 * x402 Fresh — client example.
 *
 * Run: npx tsx examples/soma-check-client.ts
 *
 * Shows the conditional-payment pattern: cache the last data hash locally,
 * send it with every subsequent call, skip payment when the server confirms
 * the data hasn't changed.
 *
 * Protocol: soma-check. External name: x402 Fresh.
 */

const BASE = process.env.CLAWNET_BASE ?? 'https://api.clawnet.com';
const API_KEY = process.env.CLAWNET_API_KEY ?? '';

if (!API_KEY) {
  console.warn('Set CLAWNET_API_KEY to run this against a real endpoint.');
}

// Per-endpoint last-known hash. In real clients this lives in whatever store
// you already use (Redis, SQLite, an in-memory LRU, etc.).
const hashCache = new Map<string, string>();

interface CallResult {
  data: unknown | null;
  charged: number;
  unchanged: boolean;
  hash: string | null;
}

/**
 * Call a ClawNet endpoint with conditional payment.
 * If our cached hash matches, the server returns unchanged:true and we pay 0.
 */
async function callWithFresh(
  endpointId: string,
  params: Record<string, unknown>,
): Promise<CallResult> {
  const lastHash = hashCache.get(endpointId);

  const response = await fetch(`${BASE}/v1/endpoints/${endpointId}/call`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...(lastHash ? { 'If-Fresh-Hash': lastHash } : {}),
    },
    body: JSON.stringify({ params }),
  });

  const body = (await response.json()) as {
    unchanged?: boolean;
    data?: unknown;
    dataHash?: string;
    creditsUsed?: number;
  };

  // Prefer the response header; fall back to body field.
  const newHash =
    response.headers.get('X-Fresh-Hash') ??
    response.headers.get('X-Soma-Hash') ??
    body.dataHash ??
    null;

  if (body.unchanged) {
    return { data: null, charged: 0, unchanged: true, hash: newHash };
  }

  if (newHash) hashCache.set(endpointId, newHash);

  return {
    data: body.data ?? null,
    charged: body.creditsUsed ?? 0,
    unchanged: false,
    hash: newHash,
  };
}

/**
 * Free probe: ask the server for the current hash without paying.
 * Useful when you want to decide whether to issue a paid call at all.
 */
async function probeHash(
  endpointId: string,
  params: Record<string, string>,
): Promise<string | null> {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(
    `${BASE}/v1/endpoints/${endpointId}/check${qs ? '?' + qs : ''}`,
  );
  const body = (await response.json()) as { dataHash?: string | null };
  return body.dataHash ?? null;
}

// ─── Demo: poll an endpoint, only pay when data changes ────────────────────

async function main() {
  const endpointId = process.argv[2] ?? 'btc-price';
  const rounds = 5;

  console.log(`Polling ${endpointId} — ${rounds} rounds, 1s apart`);
  console.log('First call will be a cache miss; subsequent calls use If-Fresh-Hash.');
  console.log('');

  let totalCharged = 0;
  let freeCalls = 0;

  for (let i = 0; i < rounds; i++) {
    const result = await callWithFresh(endpointId, { currency: 'USD' });
    totalCharged += result.charged;
    if (result.unchanged) freeCalls++;

    console.log(
      `[${i + 1}] ` +
        (result.unchanged
          ? `unchanged (charged 0, total 0 so far for skips) hash=${result.hash?.slice(0, 12)}…`
          : `fresh data (charged ${result.charged}) hash=${result.hash?.slice(0, 12)}…`),
    );

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('');
  console.log(`Summary: ${freeCalls}/${rounds} free (${Math.round((freeCalls / rounds) * 100)}% hit rate)`);
  console.log(`Total charged: ${totalCharged} credits`);
  console.log(`Without x402 Fresh: ${rounds * (totalCharged / (rounds - freeCalls || 1)).toFixed(2)} credits`);
}

// Example: standalone probe-then-call flow
async function probeThenCall() {
  const endpointId = 'btc-price';
  const myLastHash = hashCache.get(endpointId);

  const serverHash = await probeHash(endpointId, { currency: 'USD' });
  if (serverHash && serverHash === myLastHash) {
    console.log('Server hash matches mine — no call needed, no payment.');
    return;
  }
  // Hash differs or we have nothing — issue the paid call
  const result = await callWithFresh(endpointId, { currency: 'USD' });
  console.log('Paid call result:', result);
}

// Uncomment the demo you want to run:
main().catch(console.error);
// probeThenCall().catch(console.error);
