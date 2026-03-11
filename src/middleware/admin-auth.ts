import crypto from 'crypto';
import { env } from '../config/index';

/** Timing-safe string comparison via SHA-256 normalization (prevents length-based timing leaks). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Returns true if the request carries a valid X-Admin-Key header. */
export function requireAdmin(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('X-Admin-Key');
  return !!(key && env.ADMIN_API_KEY && safeEqual(key, env.ADMIN_API_KEY));
}
