/**
 * Integration test helper — builds a Hono app with real routes + middleware,
 * backed by the in-memory test DB, with mocked external services.
 *
 * Mocks:
 *   - x402Call: returns configurable test data + sets birth cert
 *   - isX402Ready: always true
 *   - getHeartSafe: returns null (no heart in unit-level integration tests)
 *   - Redis: falls back to in-memory (no REDIS_URL)
 *   - Rate limiter: passthrough (no real rate limiting)
 *
 * Usage:
 *   import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';
 *   import { createTestApp, mockX402Call } from './helpers/integration';
 *   setupTestDb();
 *   // ... in tests:
 *   const app = createTestApp();
 *   mockX402Call({ price: 42 });
 *   const res = await app.request('/v1/endpoints/claw-token-price/call', { ... });
 */
import { vi } from 'vitest';

// ── Mock x402Call BEFORE any src imports ────────────────────────────────

type BirthCertificate = {
  dataHash: string;
  signature: string;
  timestamp: string;
  publicKey: string;
  heartbeatIndex: number;
};

let _mockData: unknown = { price: 42 };
let _mockBirthCert: BirthCertificate | null = null;
let _mockShouldThrow: Error | null = null;

vi.mock('../../../src/providers/x402-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/providers/x402-client')>();
  let _lastCert: BirthCertificate | null = null;

  return {
    ...actual,
    initX402Client: vi.fn(async () => true),
    isX402Ready: vi.fn(() => true),
    x402Call: vi.fn(async () => {
      if (_mockShouldThrow) throw _mockShouldThrow;
      // Set birth cert (mimics heart.fetchData flow)
      _lastCert = _mockBirthCert;
      return _mockData;
    }),
    getLastBirthCertificate: vi.fn(() => {
      const cert = _lastCert;
      _lastCert = null; // get-and-clear pattern
      return cert;
    }),
  };
});

// Mock soma heart — no heart in integration tests
vi.mock('../../../src/core/soma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/soma')>();
  return {
    ...actual,
    getHeartSafe: vi.fn(() => null),
    initHeart: vi.fn(async () => {}),
  };
});

// Mock dual-sign state — no dual-sign in integration tests
vi.mock('../../../src/core/dual-sign-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/dual-sign-state')>();
  return {
    ...actual,
    getLastDualSignResult: vi.fn(() => null),
    extractDualSignReceiptFields: vi.fn(() => ({})),
  };
});

// Mock soma receipt — fire-and-forget, just resolve
vi.mock('../../../src/core/soma-receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/soma-receipt')>();
  return {
    ...actual,
    createSomaReceipt: vi.fn(async () => null),
  };
});

// Mock keep-warm (depends on async cache internals)
vi.mock('../../../src/cache/keep-warm', () => ({
  recordDemand: vi.fn(),
  recordWarmHit: vi.fn(),
  startKeepWarm: vi.fn(),
}));

// ── Public API ─────────────────────────────────────────────────────────────

/** Set what x402Call returns on next invocation */
export function mockX402Call(data: unknown): void {
  _mockData = data;
}

/** Set a birth cert that x402Call will produce (mimics heart.fetchData) */
export function mockBirthCert(cert: BirthCertificate | null): void {
  _mockBirthCert = cert;
}

/** Make x402Call throw on next invocation */
export function mockX402Throw(err: Error | null): void {
  _mockShouldThrow = err;
}

/** Generate a realistic-looking test birth cert */
export function makeBirthCert(dataHash?: string): BirthCertificate {
  return {
    dataHash: dataHash ?? 'sha256:abc123def456',
    signature: 'test-sig-' + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    publicKey: 'test-pub-key-' + Math.random().toString(36).slice(2),
    heartbeatIndex: Math.floor(Math.random() * 1000),
  };
}

/** Create the Hono test app with endpoint routes + auth middleware */
export async function createTestApp() {
  const { Hono } = await import('hono');
  const { checkApiKey } = await import('../../../src/middleware/auth');
  const { endpointsRouter } = await import('../../../src/routes/endpoints');

  const app = new Hono();

  // Auth middleware on call routes (mirrors index.ts)
  app.use('/v1/endpoints/*/call', checkApiKey);

  // Mount endpoints router
  app.route('/v1/endpoints', endpointsRouter);

  return app;
}

/** Generate a key matching the cn-[a-f0-9]{48} auth format */
export function validApiKey(): string {
  const hex = Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `cn-${hex}`;
}

/** Make a POST request with API key auth */
export function callEndpoint(
  app: ReturnType<typeof import('hono')['Hono']['prototype']['request']> extends never ? never : { request: (...args: any[]) => Promise<Response> },
  endpointId: string,
  opts: {
    apiKey: string;
    params?: Record<string, unknown>;
    freshness?: string;
    ifSomaHash?: string;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const body: Record<string, unknown> = {};
  if (opts.params) body.params = opts.params;
  if (opts.freshness) body.freshness = opts.freshness;
  if (opts.ifSomaHash) body.ifSomaHash = opts.ifSomaHash;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': opts.apiKey,
    ...opts.headers,
  };

  return app.request(`/v1/endpoints/${endpointId}/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
