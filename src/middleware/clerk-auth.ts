import { createMiddleware } from 'hono/factory';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { logger } from '../utils/logger';
import { env } from '../config/index';

declare module 'hono' {
  interface ContextVariableMap {
    clerkUserId: string;
    clerkEmail: string | null;
  }
}

export const requireClerkAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ error: 'Unauthorized — missing Bearer token', code: 'UNAUTHORIZED' }, 401);
  }

  const secretKey = env.CLERK_SECRET_KEY ?? '';
  if (!secretKey) {
    logger.error('CLERK_SECRET_KEY not set');
    return c.json({ error: 'Auth not configured' }, 500);
  }

  try {
    const clerk = createClerkClient({ secretKey });
    const payload = await verifyToken(token, { secretKey });

    c.set('clerkUserId', payload.sub);

    // Get email from Clerk user
    try {
      const user = await clerk.users.getUser(payload.sub);
      const primaryEmail = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId
      )?.emailAddress ?? null;
      c.set('clerkEmail', primaryEmail);
    } catch {
      c.set('clerkEmail', null);
    }

    await next();
  } catch (err) {
    logger.warn({ err }, 'Clerk token verification failed');
    return c.json({ error: 'Invalid or expired session', code: 'UNAUTHORIZED' }, 401);
  }
});