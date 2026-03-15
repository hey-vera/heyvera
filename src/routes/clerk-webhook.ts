import { Hono } from 'hono';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { getDb, logAudit } from '../db/index';

export const clerkWebhookRouter = new Hono();

// Free trials are disabled. Users must purchase credits.

/**
 * Verify Clerk webhook signature (svix-based HMAC-SHA256).
 * Clerk signs webhooks using svix. The secret starts with "whsec_".
 * Docs: https://clerk.com/docs/integrations/webhooks/overview
 */
function verifyClerkSignature(
  rawBody: string,
  headers: { svixId: string; svixTimestamp: string; svixSignature: string },
  secret: string,
): boolean {
  try {
    // Decode base64 secret (strip "whsec_" prefix if present)
    const base64Secret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const secretBytes = Buffer.from(base64Secret, 'base64');

    const signedContent = `${headers.svixId}.${headers.svixTimestamp}.${rawBody}`;
    const expectedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

    // Clerk may send multiple signatures (e.g. "v1,abc123 v1,def456")
    const signatures = headers.svixSignature.split(' ');
    return signatures.some((sig) => {
      const [, sigValue] = sig.split(',');
      if (!sigValue) return false;
      const a = Buffer.from(sigValue);
      const b = Buffer.from(expectedSig);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    });
  } catch {
    return false;
  }
}

// POST /v1/webhooks/clerk
clerkWebhookRouter.post('/clerk', async (c) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('CLERK_WEBHOOK_SECRET not set — Clerk webhooks disabled');
    return c.json({ received: true }); // Return 200 so Clerk doesn't retry
  }

  const svixId = c.req.header('svix-id') ?? '';
  const svixTimestamp = c.req.header('svix-timestamp') ?? '';
  const svixSignature = c.req.header('svix-signature') ?? '';

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: 'Missing svix headers' }, 400);
  }

  // Replay attack guard: reject if timestamp is >5 minutes old
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) {
    logger.warn({ svixId }, 'Clerk webhook: timestamp too old (possible replay attack)');
    return c.json({ error: 'Timestamp too old' }, 400);
  }

  const rawBody = await c.req.text();

  if (!verifyClerkSignature(rawBody, { svixId, svixTimestamp, svixSignature }, secret)) {
    logger.warn({ svixId }, 'Clerk webhook: signature verification failed');
    return c.json({ error: 'Invalid signature' }, 400);
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  logger.info({ type: event.type, svixId }, 'Clerk webhook received');

  if (event.type === 'user.created') {
    const clerkUserId = event.data.id as string;
    if (!clerkUserId) {
      logger.warn({ svixId }, 'Clerk user.created: missing user id');
      return c.json({ received: true });
    }

    // Free trials are disabled. Users must purchase credits.
    logger.info({ clerkUserId }, 'Clerk user.created: account linked (no free credits — purchase required)');
  }

  // GDPR right to erasure: deactivate API key and anonymize email when user deletes their Clerk account.
  // Financial records (transactions, orchestrations, audit_log) are kept for legal/tax compliance per
  // their own retention windows (730 days / 180 days / 90 days respectively).
  // Skills are unpublished (public=0, active=0) to prevent continued use, but records are retained
  // for creator earnings and marketplace integrity.
  if (event.type === 'user.deleted') {
    const clerkUserId = event.data.id as string;
    if (!clerkUserId) {
      logger.warn({ svixId }, 'Clerk user.deleted: missing user id');
      return c.json({ received: true });
    }

    try {
      const db = getDb();
      db.transaction(() => {
        // Deactivate key and anonymize email — removes PII while preserving credit balance record
        db.prepare(`UPDATE api_keys SET active = 0, email = '[deleted]' WHERE clerk_user_id = ?`).run(clerkUserId);
        // Unpublish all skills by this user — they can no longer be discovered or purchased
        db.prepare(`
          UPDATE skills SET public = 0, active = 0
          WHERE author_key IN (SELECT key FROM api_keys WHERE clerk_user_id = ?)
        `).run(clerkUserId);
      })();
      logAudit({ entityType: 'clerk_user', entityId: clerkUserId, action: 'USER_DELETED', actorId: 'clerk' });
      logger.info({ clerkUserId }, 'Clerk user.deleted: API key deactivated, email anonymized, skills unpublished');
    } catch (err) {
      logger.error({ err, clerkUserId }, 'Clerk user.deleted: failed to process deletion');
    }
  }

  return c.json({ received: true });
});
