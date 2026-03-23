/**
 * aid-stream.ts — SSE streaming for real-time trust updates (Flaw 5 / Optimization 8)
 *
 * Replaces polling of GET /aid/heartbeat with a persistent SSE connection.
 * Reduces server load by 95%+ at scale (50K agents polling every 30s = 100K req/min
 * vs SSE push = near-zero idle load).
 *
 * Endpoints:
 *   GET /aid/stream          — subscribe to trust events (SSE)
 *   GET /aid/stream/canary   — subscribe to canary liveness events (SSE)
 *
 * Event types:
 *   trust_changed    — agent's trust score crossed a tier boundary
 *   trust_degraded   — provider trust dropped >10 points
 *   avoid_flagged    — agent flagged as avoid (instant propagation, Section 39.3)
 *   canary_published — new liveness canary (every 6h)
 *   freeze_event     — agent frozen (autonomous defense system)
 *   attestation      — new attestation created
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── Event Bus (in-memory pub/sub) ──────────────────────────────────────────

export interface TrustEvent {
  type: 'trust_changed' | 'trust_degraded' | 'avoid_flagged' | 'canary_published' | 'freeze_event' | 'attestation';
  did?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

type Listener = (event: TrustEvent) => void;

const listeners = new Set<Listener>();
const MAX_LISTENERS = 1000;

/**
 * Publish a trust event to all connected SSE clients.
 * Call this from anywhere in the codebase when trust-relevant events occur.
 */
export function publishTrustEvent(event: TrustEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch { /* don't let one bad listener break others */ }
  }
}

function addListener(fn: Listener): () => void {
  if (listeners.size >= MAX_LISTENERS) {
    logger.warn({ count: listeners.size }, 'SSE listener limit reached, rejecting new connection');
    throw new Error('Too many SSE connections');
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get current subscriber count (for monitoring) */
export function getStreamSubscriberCount(): number {
  return listeners.size;
}

// ─── Helper: trust event conveniences ───────────────────────────────────────

export function emitTrustChanged(did: string, oldScore: number, newScore: number, oldVerdict: string, newVerdict: string): void {
  publishTrustEvent({
    type: 'trust_changed',
    did,
    data: { oldScore, newScore, oldVerdict, newVerdict },
    timestamp: new Date().toISOString(),
  });
}

export function emitTrustDegraded(did: string, previousScore: number, currentScore: number, trigger: string): void {
  publishTrustEvent({
    type: 'trust_degraded',
    did,
    data: { previousScore, currentScore, trigger, severity: previousScore - currentScore > 20 ? 'critical' : 'warning' },
    timestamp: new Date().toISOString(),
  });
}

export function emitAvoidFlagged(did: string, reason: string): void {
  publishTrustEvent({
    type: 'avoid_flagged',
    did,
    data: { reason },
    timestamp: new Date().toISOString(),
  });
}

export function emitCanaryPublished(sequence: number, hash: string): void {
  publishTrustEvent({
    type: 'canary_published',
    data: { sequence, hash },
    timestamp: new Date().toISOString(),
  });
}

export function emitFreezeEvent(did: string, reason: string, freezeType: string): void {
  publishTrustEvent({
    type: 'freeze_event',
    did,
    data: { reason, freezeType },
    timestamp: new Date().toISOString(),
  });
}

// ─── GET /stream — Subscribe to all trust events (SSE) ──────────────────────

router.get('/stream', async (c) => {
  // Optional filter: only events for specific DIDs
  const filterDids = c.req.query('dids')?.split(',').filter(Boolean) || [];
  // Optional filter: only specific event types
  const filterTypes = c.req.query('types')?.split(',').filter(Boolean) || [];

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({
        message: 'Connected to AID trust event stream',
        filters: { dids: filterDids.length ? filterDids : 'all', types: filterTypes.length ? filterTypes : 'all' },
        timestamp: new Date().toISOString(),
      }),
    });

    let cleanup: (() => void) | null = null;

    try {
      cleanup = addListener(async (event) => {
        // Apply DID filter
        if (filterDids.length > 0 && event.did && !filterDids.includes(event.did)) return;
        // Apply type filter
        if (filterTypes.length > 0 && !filterTypes.includes(event.type)) return;

        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify({
              did: event.did,
              ...event.data,
              timestamp: event.timestamp,
            }),
          });
        } catch {
          // Client disconnected
        }
      });

      // Keep connection alive with periodic heartbeat
      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: 'heartbeat',
            data: JSON.stringify({
              subscribers: listeners.size,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30_000); // Every 30 seconds

      // Wait for disconnect (stream.onAbort is handled by Hono)
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeatInterval);
          resolve();
        });
      });
    } finally {
      if (cleanup) cleanup();
    }
  });
});

// ─── GET /stream/canary — Subscribe to canary events only (SSE) ─────────────

router.get('/stream/canary', async (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ message: 'Connected to AID canary stream', timestamp: new Date().toISOString() }),
    });

    let cleanup: (() => void) | null = null;

    try {
      cleanup = addListener(async (event) => {
        if (event.type !== 'canary_published') return;
        try {
          await stream.writeSSE({
            event: 'canary_published',
            data: JSON.stringify({ ...event.data, timestamp: event.timestamp }),
          });
        } catch { /* disconnected */ }
      });

      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ timestamp: new Date().toISOString() }) });
        } catch { clearInterval(heartbeatInterval); }
      }, 60_000);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => { clearInterval(heartbeatInterval); resolve(); });
      });
    } finally {
      if (cleanup) cleanup();
    }
  });
});

export { router as aidStreamRouter };
