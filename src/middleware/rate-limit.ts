import { MiddlewareHandler } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { cacheIncr } from '../cache/index';

export function getClientIp(c: Parameters<MiddlewareHandler>[0]): string {
  // In production behind a reverse proxy (Caddy/nginx), use the
  // actual socket remote address to avoid X-Forwarded-For spoofing.
  // The proxy sets X-Forwarded-For but an attacker can too.
  // connInfo is the Node.js socket — always trustworthy.
  const connInfo = (c.env as Record<string, unknown>)?.incoming as
    { socket?: { remoteAddress?: string } } | undefined;
  const socketIp = connInfo?.socket?.remoteAddress;

  if (env.NODE_ENV === 'production' && socketIp) {
    // Trust X-Forwarded-For when request comes from localhost or Docker bridge
    // (Nginx on the host → Docker container arrives as 172.x.x.x, not 127.0.0.1)
    const isFromProxy = socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1'
      || socketIp.startsWith('172.') || socketIp.startsWith('10.') || socketIp.startsWith('192.168.')
      // IPv6 private ranges: ULA (fc00::/7) and link-local (fe80::/10)
      || socketIp.startsWith('fc') || socketIp.startsWith('fd') || socketIp.startsWith('fe80');
    if (isFromProxy) {
      return c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
             c.req.header('x-real-ip') ??
             socketIp;
    }
    return socketIp;
  }

  // Development: trust headers (usually no proxy)
  return c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
         c.req.header('x-real-ip') ??
         socketIp ??
         'unknown';
}

export const rateLimiter: MiddlewareHandler = async (c, next) => {
  // Health endpoint must never be rate-limited (used by monitoring + Docker healthcheck)
  if (c.req.path === '/health' || c.req.path === '/v1/health') return next();

  const ip = getClientIp(c);

  const limit = env.RATE_LIMIT_PER_MIN;
  const key = `rl:${ip}`;

  const count = await cacheIncr(key, 60);

  // Always set rate limit headers so clients can self-throttle
  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', String(Math.max(0, limit - count)));

  if (count > limit) {
    logger.warn({ ip, count }, 'Rate limit exceeded');
    c.header('Retry-After', '60');
    return c.json({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      retryAfter: 60,
    }, 429);
  }

  await next();
};
