import { Hono } from 'hono';
import Stripe from 'stripe';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { sendApiKeyEmail } from '../utils/email';
import { createApiKey, getApiKeyByEmail, topUpCredits, getApiKeyBalance, upsertSubscription, claimStripeSession, isStripeEventProcessed, markStripeEventProcessed } from '../db/index';

export const stripeRouter = new Hono();

// Credit amounts per price ID — 1 credit = $0.001
// Bonus curve: graduated to reward higher-tier purchases and match Solana +10% at every level
const PRICE_CREDITS: Record<string, { amount: number; credits: number }> = {
  'price_1T8CG1KQHzCcG1t83xGj2JRY': { amount: 5,    credits: 5_000 },      // no bonus (entry tier)
  'price_1T8DlnKQHzCcG1t8VXWAMgJs': { amount: 20,   credits: 21_000 },     // +5%
  'price_1T8DmrKQHzCcG1t8zWDNm4Rp': { amount: 50,   credits: 54_000 },     // +8%
  'price_1T8DnfKQHzCcG1t85Fcs2lY1': { amount: 100,  credits: 112_000 },    // +12%
  'price_1T8DoVKQHzCcG1t8kPpST5ws': { amount: 500,  credits: 600_000 },    // +20%
  'price_1T8DpAKQHzCcG1t8kDyVt48A': { amount: 1000, credits: 1_300_000 },  // +30%
};

function generateApiKey(): string {
  return 'cn-' + crypto.randomBytes(24).toString('hex');
}

// POST /v1/webhooks/stripe
stripeRouter.post('/stripe', async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeSecretKey) {
    logger.error('Stripe webhook called but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set');
    return c.json({ error: 'Stripe not configured' }, 500);
  }

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

  // Atomic idempotency — INSERT OR IGNORE ensures only one concurrent request processes a session
  const isNew = claimStripeSession(session.id);
  if (!isNew) {
    logger.info({ sessionId: session.id }, 'Stripe webhook: session already processed, skipping');
    return c.json({ received: true });
  }

  // Extract email from Stripe customer details
  const email = session.customer_details?.email ?? null;

  if (!email) {
    logger.error({ sessionId: session.id }, 'Stripe webhook: no email found in session');
    return c.json({ error: 'No email found' }, 400);
  }

  // Determine credits from line items
  let credits = 0;
  let amountPaid = 0;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
    for (const item of lineItems.data) {
      const priceId = item.price?.id;
      if (priceId && PRICE_CREDITS[priceId]) {
        const qty = item.quantity ?? 1;
        credits += PRICE_CREDITS[priceId].credits * qty;
        amountPaid += PRICE_CREDITS[priceId].amount * qty;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Stripe webhook: could not fetch line items, using session amount');
    amountPaid = Math.round((session.amount_total ?? 0) / 100);
    credits = amountPaid * 1000; // fallback: 1000 credits per dollar
  }

  if (credits === 0) {
    logger.error({ sessionId: session.id }, 'Stripe webhook: could not determine credits');
    return c.json({ error: 'Could not determine credits' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if this email already has an active key
  const existingKey = getApiKeyByEmail(normalizedEmail);

  let apiKey: string;
  let totalCredits: number;

  if (existingKey) {
    // Returning customer — top up their existing key
    apiKey = existingKey.key;
    topUpCredits(apiKey, credits, session.id);
    const updated = getApiKeyBalance(apiKey);
    totalCredits = updated?.credits ?? (existingKey.credits + credits);
    logger.info({ email: normalizedEmail, addedCredits: credits, totalCredits }, 'Credits topped up for existing key');
  } else {
    // New customer — create a fresh key
    apiKey = generateApiKey();
    createApiKey({
      key: apiKey,
      email: normalizedEmail,
      credits,
      stripeSessionId: session.id,
      amountPaid,
    });
    totalCredits = credits;
    logger.info({ email: normalizedEmail, credits, amountPaid }, 'New API key created');
  }

  // Send email showing their key + current total balance
  try {
    await sendApiKeyEmail({
      to: normalizedEmail,
      apiKey,
      credits: totalCredits,
      amountPaid,
    });
  } catch (err) {
    logger.error({ err, email: normalizedEmail }, 'Failed to send API key email — key was created/updated in DB');
  }

  return c.json({ received: true });
});

// POST /v1/webhooks/stripe-subscriptions
// Handles monthly subscription events. Set STRIPE_SUBSCRIPTION_PRICE_ID in .env
// and create the product in Stripe Dashboard ($29/mo → 35,000 credits/mo).
const SUBSCRIPTION_CREDITS_PER_MONTH = parseInt(process.env.SUBSCRIPTION_CREDITS_PER_MONTH ?? '40000');

stripeRouter.post('/stripe-subscriptions', async (c) => {
  const webhookSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeSecretKey) {
    return c.json({ error: 'Stripe subscription webhooks not configured' }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);

  const stripe = new Stripe(stripeSecretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  logger.info({ type: event.type, id: event.id }, 'Stripe subscription webhook received');

  // Idempotency: skip already-processed events
  if (isStripeEventProcessed(event.id)) {
    logger.info({ eventId: event.id }, 'Stripe subscription event already processed — skipping');
    return c.json({ received: true });
  }

  // Monthly invoice paid — top up credits
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const email = invoice.customer_email?.toLowerCase().trim();
    const rawSub = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
    const subscriptionId = typeof rawSub === 'string' ? rawSub : rawSub?.id;
    const periodEnd = new Date((invoice.lines.data[0]?.period?.end ?? 0) * 1000).toISOString();

    if (!email || !subscriptionId) {
      logger.warn({ invoiceId: invoice.id }, 'Subscription invoice missing email or subscription ID');
      return c.json({ received: true });
    }

    const existingKey = getApiKeyByEmail(email);
    if (!existingKey) {
      logger.warn({ email }, 'Subscription payment but no API key found for email — credits not applied');
      return c.json({ received: true });
    }

    topUpCredits(existingKey.key, SUBSCRIPTION_CREDITS_PER_MONTH);
    upsertSubscription({
      subscriptionId,
      apiKey: existingKey.key,
      email,
      creditsPerMonth: SUBSCRIPTION_CREDITS_PER_MONTH,
      currentPeriodEnd: periodEnd,
      status: 'active',
    });

    logger.info({ email, credits: SUBSCRIPTION_CREDITS_PER_MONTH, subscriptionId }, 'Subscription credits applied');
  }

  // Subscription cancelled
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const email = (sub as unknown as { customer_email?: string }).customer_email?.toLowerCase().trim();
    const apiKey = email ? getApiKeyByEmail(email)?.key : undefined;
    if (!apiKey) {
      logger.warn({ subscriptionId: sub.id }, 'Subscription cancelled but no API key found — skipping record');
    } else {
      upsertSubscription({
        subscriptionId: sub.id,
        apiKey,
        email: email ?? '',
        creditsPerMonth: SUBSCRIPTION_CREDITS_PER_MONTH,
        currentPeriodEnd: new Date(((sub as unknown as { current_period_end: number }).current_period_end ?? 0) * 1000).toISOString(),
        status: 'cancelled',
      });
    }
    logger.info({ subscriptionId: sub.id }, 'Subscription cancelled');
  }

  markStripeEventProcessed(event.id);
  return c.json({ received: true });
});