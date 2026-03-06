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

export function isEndpointAvailable(endpointId: string): boolean {
  const h = getHealth(endpointId);

  if (h.state === 'CLOSED') return true;

  if (h.state === 'OPEN') {
    if (Date.now() - h.openedAt > COOLDOWN_MS) {
      h.state = 'HALF_OPEN';
      h.successes = 0;
      logger.info({ endpointId }, 'Circuit breaker: HALF_OPEN');
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
    return;
  }

  if (h.state === 'CLOSED' && h.failures >= FAILURE_THRESHOLD) {
    h.state = 'OPEN';
    h.openedAt = Date.now();
    logger.warn({ endpointId, failures: h.failures }, 'Circuit breaker: OPEN');
  }
}

export function getCircuitStats() {
  const stats: Record<string, { state: CircuitState; failures: number }> = {};
  for (const [id, h] of health.entries()) {
    stats[id] = { state: h.state, failures: h.failures };
  }
  return stats;
}