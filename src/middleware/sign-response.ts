/**
 * ClawGuard — HMAC-SHA256 response signing.
 * Adds X-ClawNet-Signature header so callers can verify responses are authentic.
 * Format: t=<unix_ms>,v1=<hmac-sha256(t.body, secret)>
 */
import type { MiddlewareHandler } from 'hono';
import { createHmac } from 'crypto';
import { env } from '../config/index';
import { logger } from '../utils/logger';

let warnedMissingSecret = false;

export const signResponse: MiddlewareHandler = async (c, next) => {
  await next();

  const secret = env.PLATFORM_SIGNING_SECRET;
  if (!secret) {
    if (!warnedMissingSecret) {
      logger.warn('PLATFORM_SIGNING_SECRET not set — response signing disabled');
      warnedMissingSecret = true;
    }
    return;
  }

  try {
    const body = await c.res.clone().text();
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', secret)
      .update(`${ts}.${body}`)
      .digest('hex');
    c.res.headers.set('X-ClawNet-Signature', `t=${ts},v1=${sig}`);
  } catch (err) {
    logger.warn({ err }, 'Response signing failed — sending unsigned response');
  }
};
