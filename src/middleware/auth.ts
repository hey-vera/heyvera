import { MiddlewareHandler } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';

export const checkApiKey: MiddlewareHandler = async (c, next) => {
  if (!env.API_KEYS) {
    await next();
    return;
  }

  const validKeys = env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean);
  if (validKeys.length === 0) {
    await next();
    return;
  }

  const providedKey = c.req.header('X-API-Key');
  if (!providedKey || !validKeys.includes(providedKey)) {
    logger.warn({ ip: c.req.header('x-forwarded-for') ?? 'unknown' }, 'Invalid API key');
    return c.json({ error: 'Invalid or missing API key', code: 'INVALID_API_KEY', hint: 'Add X-API-Key header' }, 401);
  }

  await next();
};