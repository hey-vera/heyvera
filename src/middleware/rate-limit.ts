import { MiddlewareHandler } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { cacheIncr } from '../cache/index';

export const rateLimiter: MiddlewareHandler = async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
              c.req.header('x-real-ip') ??
              'unknown';

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
