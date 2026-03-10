import { logger } from '../utils/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface EndpointHealth {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number;
  openedAt: number;
}

const health = new Map<string, EndpointHealth>();
const FAILURE_THRESHOLD = 5;
const SUCCESS_THRESHOLD = 2;
const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

// Redis client reference — populated lazily after initRedis() runs
let _redis: import('ioredis').Redis | null = null;

export function setCircuitRedis(client: import('ioredis').Redis | null) {
  _redis = client;
}

async function persistState(id: string, h: EndpointHealth) {
  if (!_redis) return;
  try {
    await _redis.set(`cb:${id}`, JSON.stringify(h), 'EX', 60 * 60 * 24); // 24h TTL
  } catch { /* best-effort */ }
}

async function loadState(id: string): Promise<EndpointHealth | null> {
  if (!_redis) return null;
  try {
    const raw = await _redis.get(`cb:${id}`);
    if (raw) return JSON.parse(raw) as EndpointHealth;
  } catch { /* best-effort */ }
  return null;
}

function getHealth(endpointId: string): EndpointHealth {
  if (!health.has(endpointId)) {
    health.set(endpointId, {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailure: 0,
      openedAt: 0,
    });
  }
  return health.get(endpointId)!;
}

export async function loadCircuitFromRedis(endpointId: string): Promise<void> {
  const stored = await loadState(endpointId);
  if (stored) health.set(endpointId, stored);
}

export function isEndpointAvailable(endpointId: string): boolean {
  const h = getHealth(endpointId);

  if (h.state === 'CLOSED') return true;

  if (h.state === 'OPEN') {
    if (Date.now() - h.openedAt > COOLDOWN_MS) {
      h.state = 'HALF_OPEN';
      h.successes = 0;
      logger.info({ endpointId }, 'Circuit breaker: HALF_OPEN');
      void persistState(endpointId, h);
      return true;
    }
    return false;
  }

  // HALF_OPEN — allow one request through
  return true;
}

export function recordSuccess(endpointId: string): void {
  const h = getHealth(endpointId);
  h.failures = 0;

  if (h.state === 'HALF_OPEN') {
    h.successes++;
    if (h.successes >= SUCCESS_THRESHOLD) {
      h.state = 'CLOSED';
      logger.info({ endpointId }, 'Circuit breaker: CLOSED (recovered)');
      void persistState(endpointId, h);
    }
  }
}

export function recordFailure(endpointId: string): void {
  const h = getHealth(endpointId);
  h.failures++;
  h.lastFailure = Date.now();

  if (h.state === 'HALF_OPEN') {
    h.state = 'OPEN';
    h.openedAt = Date.now();
    logger.warn({ endpointId }, 'Circuit breaker: OPEN (half-open failed)');
    void persistState(endpointId, h);
    return;
  }

  if (h.state === 'CLOSED' && h.failures >= FAILURE_THRESHOLD) {
    h.state = 'OPEN';
    h.openedAt = Date.now();
    logger.warn({ endpointId, failures: h.failures }, 'Circuit breaker: OPEN');
    void persistState(endpointId, h);
  }
}

export function getCircuitStats() {
  const stats: Record<string, { state: CircuitState; failures: number }> = {};
  for (const [id, h] of health.entries()) {
    stats[id] = { state: h.state, failures: h.failures };
  }
  return stats;
}

const MAX_CIRCUITS = 500;

// Purge stale CLOSED entries every 24h to prevent unbounded Map growth
setInterval(() => {
  const now = Date.now();
  for (const [id, h] of health.entries()) {
    if (h.state === 'CLOSED' && h.failures === 0 && now - h.lastFailure > 24 * 60 * 60 * 1000) {
      health.delete(id);
    }
  }
  // Hard cap — evict oldest CLOSED entries if still over limit
  if (health.size > MAX_CIRCUITS) {
    const closed = [...health.entries()].filter(([, h]) => h.state === 'CLOSED');
    closed.sort((a, b) => a[1].lastFailure - b[1].lastFailure);
    for (const [id] of closed.slice(0, health.size - MAX_CIRCUITS)) {
      health.delete(id);
    }
  }
}, 24 * 60 * 60 * 1000).unref();
