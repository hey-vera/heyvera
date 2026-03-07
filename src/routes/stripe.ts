import { Hono } from 'hono';
import Stripe from 'stripe';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { sendApiKeyEmail } from '../utils/email';
import { createApiKey, getApiKeyByStripeSession } from '../db/index';

export const stripeRouter = new Hono();

// Credit amounts per price ID — $1 = 15 queries
// Larger packages get bonus credits
const PRICE_CREDITS: Record<string, { amount: number; credits: number }> = {
  'price_1T8CG1KQHzCcG1t83xGj2JRY': { amount: 5,    credits: 75 },
  'price_1T8CG1KQHzCcG1t8idmuvj3H': { amount: 20,   credits: 300 },
  'price_1T8CG1KQHzCcG1t8dx8GYc9l': { amount: 50,   credits: 750 },
  'price_1T8CG1KQHzCcG1t8oCtoEEHe': { amount: 100,  credits: 1500 },
  'price_1T8CG1KQHzCcG1t8pHDm1QYZ': { amount: 500,  credits: 8000 },  // +500 bonus
  'price_1T8CG1KQHzCcG1t8nFvwR9W1': { amount: 1000, credits: 17000 }, // +2000 bonus
};

function generateApiKey(): string {
  return 'cn-' + crypto.randomBytes(24).toString('hex');
}

// POST /v1/webhooks/stripe
// Raw body required for Stripe signature verification — registered before json middleware
stripeRouter.post('/stripe', async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeSecretKey) {
    logger.error('Stripe webhook called but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set');
    return c.json({ error: 'Stripe not configured' }, 500);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    logger.warn('Stripe webhook: missing signature header');
    return c.json({ error: 'Missing signature' }, 400);
  }

  const stripe = new Stripe(stripeSecretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    logger.warn({ err }, 'Stripe webhook: signature verification failed');
    return c.json({ error: 'Invalid signature' }, 400);
  }

  logger.info({ type: event.type, id: event.id }, 'Stripe webhook received');

  if (event.type !== 'checkout.session.completed') {
    return c.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Idempotency check — don't process the same session twice
  const existing = getApiKeyByStripeSession(session.id);
  if (existing) {
    logger.info({ sessionId: session.id }, 'Stripe webhook: session already processed, skipping');
    return c.json({ received: true });
  }

  // Extract email from custom field or customer_details
  const emailField = session.custom_fields?.find(
    (f) => f.label?.custom?.toLowerCase().includes('email')
  );
  const email =
    emailField?.text?.value ??
    session.customer_details?.email ??
    null;

  if (!email) {
    logger.error({ sessionId: session.id }, 'Stripe webhook: no email found in session');
    return c.json({ error: 'No email found' }, 400);
  }

  // Get line items to determine which price was purchased
  let credits = 0;
  let amountPaid = 0;

  try {
    const stripe2 = new Stripe(stripeSecretKey);
    const lineItems = await stripe2.checkout.sessions.listLineItems(session.id, { limit: 5 });

    for (const item of lineItems.data) {
      const priceId = item.price?.id;
      if (priceId && PRICE_CREDITS[priceId]) {
        const qty = item.quantity ?? 1;
        credits += PRICE_CREDITS[priceId].credits * qty;
        amountPaid += PRICE_CREDITS[priceId].amount * qty;
      }
    }
  } catch (err) {
    // Fallback: calculate from session amount
    logger.warn({ err }, 'Stripe webhook: could not fetch line items, using session amount');
    amountPaid = Math.round((session.amount_total ?? 0) / 100);
    credits = amountPaid * 15; // base rate
  }

  if (credits === 0) {
    logger.error({ sessionId: session.id }, 'Stripe webhook: could not determine credits');
    return c.json({ error: 'Could not determine credits' }, 400);
  }

  // Generate and store the API key
  const apiKey = generateApiKey();

  try {
    createApiKey({
      key: apiKey,
      email,
      credits,
      stripeSessionId: session.id,
      amountPaid,
    });

    logger.info({ email, credits, amountPaid }, 'API key created');
  } catch (err) {
    logger.error({ err, email }, 'Failed to create API key in DB');
    return c.json({ error: 'Database error' }, 500);
  }

  // Send email with the key
  try {
    await sendApiKeyEmail({ to: email, apiKey, credits, amountPaid });
  } catch (err) {
    // Email failure is logged but doesn't fail the webhook
    // Stripe would retry and we'd create a duplicate — idempotency check handles this
    logger.error({ err, email }, 'Failed to send API key email — key was created in DB');
  }

  return c.json({ received: true });
});