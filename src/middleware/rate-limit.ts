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
    // Trust X-Forwarded-For only if the connection comes from localhost (reverse proxy)
    const isFromProxy = socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1';
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
  const ip = getClientIp(c);

  const limit = env.RATE_LIMIT_PER_MIN;
  const key = `rl:${ip}`;

  const count = await cacheIncr(key, 60);

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
