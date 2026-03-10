import { Hono } from 'hono';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { getDb, logAudit } from '../db/index';
import { nanoid } from 'nanoid';
import { env } from '../config/index';

export const clerkWebhookRouter = new Hono();

const FREE_TRIAL_CREDITS = parseInt(process.env.FREE_TRIAL_CREDITS ?? '100', 10);

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
      return sigValue === expectedSig;
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
    const emailAddresses = event.data.email_addresses as Array<{ email_address: string; verification?: { status: string } }> | undefined;
    const primaryEmail = emailAddresses?.find((e) => e.verification?.status === 'verified')?.email_address
      ?? emailAddresses?.[0]?.email_address
      ?? '';

    if (!clerkUserId) {
      logger.warn({ svixId }, 'Clerk user.created: missing user id');
      return c.json({ received: true });
    }

    // Idempotency: only grant once per Clerk user
    const db = getDb();
    const existing = db.prepare('SELECT key FROM api_keys WHERE clerk_user_id = ? AND active = 1 LIMIT 1').get(clerkUserId);
    if (existing) {
      logger.info({ clerkUserId }, 'Clerk user.created: API key already exists — skipping free trial grant');
      return c.json({ received: true });
    }

    // Create API key with free trial credits
    const key = 'cn-' + crypto.randomBytes(24).toString('hex');
    try {
      db.prepare(`
        INSERT INTO api_keys (key, email, credits, credits_used, created_at, clerk_user_id, amount_paid)
        VALUES (?, ?, ?, 0, datetime('now'), ?, 0)
      `).run(key, primaryEmail.toLowerCase() || `clerk:${clerkUserId}`, FREE_TRIAL_CREDITS, clerkUserId);

      logAudit({
        entityType: 'api_key',
        entityId: key,
        action: 'CREDIT_GRANT',
        actorId: 'system',
        data: { credits: FREE_TRIAL_CREDITS, via: 'free_trial', clerkUserId },
      });

      logger.info({ clerkUserId, email: primaryEmail, credits: FREE_TRIAL_CREDITS }, 'Free trial credits granted');
    } catch (err) {
      logger.error({ err, clerkUserId }, 'Failed to create free trial API key');
    }
  }

  return c.json({ received: true });
});
