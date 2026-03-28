import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { getClientIp } from '../middleware/rate-limit';
import {
  registerExternalEndpoint,
  getExternalRegistration,
} from '../db/index';

export const registerRouter = new Hono();

// ─── IP-based rate limiter (10/hour per IP) ─────────────────────────────────

const ipHits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now >= entry.resetAt) ipHits.delete(ip);
  }
}, 10 * 60 * 1000);

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── Validation schema ──────────────────────────────────────────────────────

const RegisterSchema = z.object({
  url: z.string().url().max(2048),
  name: z.string().min(2).max(100).trim(),
  description: z.string().max(1000).trim().optional(),
  protocol: z.enum(['x402', 'l402']).default('x402'),
  http_method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  price_usd: z.number().positive().max(1000).optional(),
  payment_asset: z.string().max(20).optional(),
  payment_network: z.string().max(50).optional(),
  category: z.string().max(50).trim().optional(),
  provider: z.string().max(100).trim().optional(),
  contact_email: z.string().email().max(255).optional(),
});

// ─── POST /v1/register — Register an external x402/L402 endpoint ────────────

registerRouter.post('/', async (c) => {
  const ip = getClientIp(c);

  if (!checkIpRateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded — max 10 registrations per hour', code: 'RATE_LIMITED' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const data = parsed.data;

  // SSRF protection — block probes to internal/private addresses
  try {
    const probeUrl = new URL(data.url);
    if (probeUrl.protocol !== 'https:' && probeUrl.protocol !== 'http:') {
      return c.json({ error: 'URL must use http or https', code: 'INVALID_URL' }, 400);
    }
    const host = probeUrl.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' ||
      /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || host.startsWith('fc') || host.startsWith('fd') ||
      host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb') ||
      host.startsWith('::ffff:')) {
      return c.json({ error: 'URL must not point to private/internal addresses', code: 'SSRF_BLOCKED' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid URL', code: 'INVALID_URL' }, 400);
  }

  // Probe the URL to verify it returns 402 (basic health check)
  let healthStatus = 'unknown';
  let probeResult = '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const probeRes = await fetch(data.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'ClawNet-RegistryProbe/1.0' },
    });
    clearTimeout(timeout);
    healthStatus = probeRes.status === 402 ? 'verified_402' : 'unexpected_status';
    probeResult = `HTTP ${probeRes.status}`;
  } catch (err) {
    healthStatus = 'probe_failed';
    probeResult = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ url: data.url, err: probeResult }, 'Registration probe failed');
  }

  try {
    const id = registerExternalEndpoint({
      url: data.url,
      name: data.name,
      description: data.description,
      protocol: data.protocol,
      httpMethod: data.http_method,
      priceUsd: data.price_usd,
      paymentAsset: data.payment_asset,
      paymentNetwork: data.payment_network,
      category: data.category,
      provider: data.provider,
      contactEmail: data.contact_email,
      healthStatus,
      probeResult,
      registeredIp: ip,
    });

    const registration = getExternalRegistration(id);
    return c.json(registration, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'This URL + protocol combination is already registered', code: 'DUPLICATE_REGISTRATION' }, 409);
    }
    logger.error({ err: msg }, 'Failed to register external endpoint');
    return c.json({ error: 'Registration failed', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ─── GET /v1/register/:id — Check registration status ──────────────────────

registerRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const registration = getExternalRegistration(id);
  if (!registration) {
    return c.json({ error: 'Registration not found', code: 'NOT_FOUND' }, 404);
  }
  return c.json(registration);
});
