import { MiddlewareHandler } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export const rateLimiter: MiddlewareHandler = async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 
              c.req.header('x-real-ip') ?? 
              'unknown';
  
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = env.RATE_LIMIT_PER_MIN;

  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    // Evict oldest entry if store is at capacity (prevents OOM under IP flood)
    if (!entry && store.size >= 50_000) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
    store.set(ip, { count: 1, resetAt: now + windowMs });
    await next();
    return;
  }

  entry.count++;

  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    logger.warn({ ip, count: entry.count }, 'Rate limit exceeded');
    c.header('Retry-After', String(retryAfter));
    return c.json({ 
      error: 'Too many requests', 
      code: 'RATE_LIMITED',
      retryAfter 
    }, 429);
  }

  await next();
};