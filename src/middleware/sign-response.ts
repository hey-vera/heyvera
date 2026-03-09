/**
 * ClawGuard — HMAC-SHA256 response signing.
 * Adds X-ClawNet-Signature header so callers can verify responses are authentic.
 * Format: t=<unix_ms>,v1=<hmac-sha256(t.body, secret)>
 */
import type { MiddlewareHandler } from 'hono';
import { createHmac } from 'crypto';
import { env } from '../config/index';

export const signResponse: MiddlewareHandler = async (c, next) => {
  await next();

  const secret = env.PLATFORM_SIGNING_SECRET;
  if (!secret) return; // Skip if not configured

  try {
    const body = await c.res.clone().text();
    const ts = Date.now().toString();
    const sig = createHmac('sha256', secret)
      .update(`${ts}.${body}`)
      .digest('hex');
    c.res.headers.set('X-ClawNet-Signature', `t=${ts},v1=${sig}`);
  } catch {
    // Non-fatal — don't break the response
  }
};
