import { Hono } from 'hono';
import Stripe from 'stripe';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { env } from '../config/index';
import { sendApiKeyEmail } from '../utils/email';
import { createApiKey, getApiKeyByEmail, topUpCredits, getApiKeyBalance, upsertSubscription, claimStripeSession, isStripeSessionClaimed, isStripeEventProcessed, markStripeEventProcessed, getDb, getStripeChargeRefundedCents, upsertStripeChargeRefundedCents } from '../db/index';

export const stripeRouter = new Hono();

// Credit amounts per price ID — 1 credit = $0.001
// Volume discount curve: aggressive at top tiers to retain enterprise customers.
//   Effective rates: $5=1000/$ → $20=1100/$ → $50=1200/$ → $100=1250/$ → $500=1500/$ → $1000=2000/$
// Annual pricing: ~15% more credits than 12× equivalent monthly tier.
// Create products in Stripe Dashboard, then set these env vars to the resulting price IDs:
//   STRIPE_ANNUAL_PRICE_100  → $1,200/yr → 1,725,000 credits (15% over 12×$100=1,500,000)
//   STRIPE_ANNUAL_PRICE_500  → $6,000/yr → 10,350,000 credits (15% over 12×$500=9,000,000)
//   STRIPE_ANNUAL_PRICE_1000 → $12,000/yr → 27,600,000 credits (15% over 12×$1000=24,000,000)
const annualPrices: Record<string, { amount: number; credits: number }> = {};
if (process.env.STRIPE_ANNUAL_PRICE_100)  annualPrices[process.env.STRIPE_ANNUAL_PRICE_100]  = { amount: 1200,  credits: 1_725_000 };
if (process.env.STRIPE_ANNUAL_PRICE_500)  annualPrices[process.env.STRIPE_ANNUAL_PRICE_500]  = { amount: 6000,  credits: 10_350_000 };
if (process.env.STRIPE_ANNUAL_PRICE_1000) annualPrices[process.env.STRIPE_ANNUAL_PRICE_1000] = { amount: 12000, credits: 27_600_000 };

const PRICE_CREDITS: Record<string, { amount: number; credits: number }> = {
  'price_1T8CG1KQHzCcG1t83xGj2JRY': { amount: 5,    credits: 5_000 },      // base rate (1000/$)
  'price_1T8DlnKQHzCcG1t8VXWAMgJs': { amount: 20,   credits: 22_000 },     // +10% (1100/$)
  'price_1T8DmrKQHzCcG1t8zWDNm4Rp': { amount: 50,   credits: 60_000 },     // +20% (1200/$)
  'price_1T8DnfKQHzCcG1t85Fcs2lY1': { amount: 100,  credits: 125_000 },    // +25% (1250/$)
  'price_1T8DoVKQHzCcG1t8kPpST5ws': { amount: 500,  credits: 750_000 },    // +50% (1500/$)
  'price_1T8DpAKQHzCcG1t8kDyVt48A': { amount: 1000, credits: 2_000_000 },  // +100% (2000/$)
  ...annualPrices,
};

function generateApiKey(): string {
  return 'cn-' + crypto.randomBytes(24).toString('hex');
}

// POST /v1/webhooks/stripe
stripeRouter.post('/stripe', async (c) => {
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = env.STRIPE_SECRET_KEY;

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

  // ── Refund handler ─────────────────────────────────────────────────────────
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const email = charge.billing_details?.email?.toLowerCase().trim();

    if (!email) {
      logger.warn({ chargeId: charge.id }, 'Stripe refund: no email on charge — cannot deduct credits');
      return c.json({ received: true });
    }

    const existingKey = getApiKeyByEmail(email);
    if (!existingKey) {
      logger.warn({ email, chargeId: charge.id }, 'Stripe refund: no API key found for email');
      return c.json({ received: true });
    }

    // Idempotency: track cumulative refunded cents per charge.
    // charge.amount_refunded is the running total (not just this webhook's delta),
    // so we only process the delta since our last recorded amount.
    const previousCents = getStripeChargeRefundedCents(charge.id);
    const newCents = charge.amount_refunded - previousCents;

    if (newCents <= 0) {
      logger.info({ chargeId: charge.id, previousCents, totalCents: charge.amount_refunded },
        'Stripe refund: already processed up to this amount — skipping');
      return c.json({ received: true });
    }

    const newRefundedUsd = newCents / 100;

    // Proportional credit deduction: use the user's actual credit-to-dollar ratio
    // (accounts for bonus credits at higher tiers, not just flat 1000/dollar).
    const db = getDb();
    const deducted = db.transaction(() => {
      const bal = db
        .prepare('SELECT credits, credits_used, amount_paid FROM api_keys WHERE key = ? AND active = 1')
        .get(existingKey.key) as { credits: number; credits_used: number; amount_paid: number } | undefined;

      if (!bal) return 0;

      // Calculate credits to deduct proportional to refund fraction
      let creditsToDeduct: number;
      if (bal.amount_paid > 0) {
        const totalGranted = bal.credits + bal.credits_used;
        const creditsPerDollar = totalGranted / bal.amount_paid;
        creditsToDeduct = Math.round(newRefundedUsd * creditsPerDollar);
      } else {
        creditsToDeduct = Math.floor(newRefundedUsd * 1000); // fallback: base rate
      }

      const deductAmount = Math.min(creditsToDeduct, bal.credits);
      if (deductAmount <= 0) {
        upsertStripeChargeRefundedCents(charge.id, charge.amount_refunded);
        return 0;
      }

      db.prepare('UPDATE api_keys SET credits = credits - ?, amount_paid = MAX(0, amount_paid - ?) WHERE key = ? AND active = 1')
        .run(deductAmount, newRefundedUsd, existingKey.key);
      upsertStripeChargeRefundedCents(charge.id, charge.amount_refunded);
      return deductAmount;
    })();

    logger.info({ email, chargeId: charge.id, newRefundedUsd, creditsDeducted: deducted }, 'Stripe refund: credits deducted');
    return c.json({ received: true });
  }

  if (event.type !== 'checkout.session.completed') {
    return c.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Fast pre-flight check (read-only) — skip the Stripe API call if already processed
  if (isStripeSessionClaimed(session.id)) {
    logger.info({ sessionId: session.id }, 'Stripe webhook: session already processed, skipping');
    return c.json({ received: true });
  }

  // Extract email from Stripe customer details
  const email = session.customer_details?.email ?? null;

  if (!email) {
    logger.error({ sessionId: session.id }, 'Stripe webhook: no email found in session');
    return c.json({ error: 'No email found' }, 400);
  }

  // Determine credits from line items (async — must happen BEFORE the atomic claim+grant)
  let credits = 0;
  let amountPaid = 0;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
    for (const item of lineItems.data) {
      const priceId = item.price?.id;
      if (priceId && PRICE_CREDITS[priceId]) {
        const qty = item.quantity ?? 1;
        if (qty < 1 || qty > 100) {
          logger.error({ sessionId: session.id, qty }, 'Stripe webhook: quantity out of bounds');
          continue;
        }
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

  // Atomic transaction: claim session + grant credits together.
  // If the process crashed after a previous claim but before credits were granted,
  // the claim row was rolled back with the transaction, so this attempt will succeed.
  let apiKey: string;
  let totalCredits: number;

  const txResult = getDb().transaction(() => {
    // Claim inside the transaction — if already claimed, abort (return null)
    if (!claimStripeSession(session.id)) return null;

    const existingKey = getApiKeyByEmail(normalizedEmail);
    if (existingKey) {
      topUpCredits(existingKey.key, credits, session.id, amountPaid);
      const updated = getApiKeyBalance(existingKey.key);
      return { key: existingKey.key, total: updated?.credits ?? (existingKey.credits + credits), isNew: false };
    }
    const newKey = generateApiKey();
    createApiKey({ key: newKey, email: normalizedEmail, credits, stripeSessionId: session.id, amountPaid });
    return { key: newKey, total: credits, isNew: true };
  })();

  if (!txResult) {
    logger.info({ sessionId: session.id }, 'Stripe webhook: session already processed (concurrent request), skipping');
    return c.json({ received: true });
  }

  apiKey = txResult.key;
  totalCredits = txResult.total;
  if (txResult.isNew) {
    logger.info({ email: normalizedEmail, credits, amountPaid }, 'New API key created');
  } else {
    logger.info({ email: normalizedEmail, addedCredits: credits, totalCredits }, 'Credits topped up for existing key');
  }

  // Fire-and-forget — don't block the webhook response (Stripe retries on slow responses)
  sendApiKeyEmail({ to: normalizedEmail, apiKey, credits: totalCredits, amountPaid })
    .catch((err) => logger.error({ err, email: normalizedEmail }, 'Failed to send API key email — key was created/updated in DB'));

  return c.json({ received: true });
});

// POST /v1/webhooks/stripe-subscriptions
// Handles monthly subscription events. Set STRIPE_SUBSCRIPTION_PRICE_ID in .env
// and create the product in Stripe Dashboard ($29/mo → 35,000 credits/mo).
const SUBSCRIPTION_CREDITS_PER_MONTH = parseInt(process.env.SUBSCRIPTION_CREDITS_PER_MONTH ?? '50000');

stripeRouter.post('/stripe-subscriptions', async (c) => {
  const webhookSecret = env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  const stripeSecretKey = env.STRIPE_SECRET_KEY;

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

    // Atomic: claim event + topUp + upsertSubscription in one transaction.
    // If the process crashes mid-flight, the event row is rolled back and Stripe's retry succeeds.
    const subResult = getDb().transaction(() => {
      // Idempotency inside transaction — INSERT OR IGNORE, abort if already done
      const claimed = getDb()
        .prepare('INSERT OR IGNORE INTO stripe_processed_events (event_id) VALUES (?)')
        .run(event.id);
      if (claimed.changes === 0) return null; // already processed by a concurrent request

      // E3 — Cap rollover at 3× monthly allotment to prevent unbounded accumulation.
      const MAX_ROLLOVER = SUBSCRIPTION_CREDITS_PER_MONTH * 3;
      const currentBal = getApiKeyBalance(existingKey.key);
      const currentCredits = currentBal?.credits ?? 0;
      const creditsToAdd = Math.max(0, Math.min(SUBSCRIPTION_CREDITS_PER_MONTH, MAX_ROLLOVER - currentCredits));
      if (creditsToAdd < SUBSCRIPTION_CREDITS_PER_MONTH) {
        logger.warn({
          email, currentCredits, monthlyAllotment: SUBSCRIPTION_CREDITS_PER_MONTH,
          maxRollover: MAX_ROLLOVER, creditsAdded: creditsToAdd,
          creditsCapped: SUBSCRIPTION_CREDITS_PER_MONTH - creditsToAdd,
        }, 'Subscription rollover cap: credits reduced to prevent exceeding 3x monthly limit');
      }
      if (creditsToAdd > 0) {
        topUpCredits(existingKey.key, creditsToAdd);
      }
      upsertSubscription({
        subscriptionId,
        apiKey: existingKey.key,
        email,
        creditsPerMonth: SUBSCRIPTION_CREDITS_PER_MONTH,
        currentPeriodEnd: periodEnd,
        status: 'active',
      });
      return { creditsToAdd, currentCredits };
    })();

    if (!subResult) {
      logger.info({ eventId: event.id }, 'Subscription: event already processed by concurrent request — skipping');
      return c.json({ received: true });
    }
    logger.info({ email, creditsAdded: subResult.creditsToAdd, currentCredits: subResult.currentCredits, subscriptionId }, 'Subscription credits applied');
  }

  // Subscription cancelled — wrap in transaction to be idempotent on Stripe retries
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const email = (sub as unknown as { customer_email?: string }).customer_email?.toLowerCase().trim();
    getDb().transaction(() => {
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
      markStripeEventProcessed(event.id);
    })();
    logger.info({ subscriptionId: sub.id }, 'Subscription cancelled');
    return c.json({ received: true });
  }

  // Note: stripe_processed_events row is inserted inside the invoice.payment_succeeded transaction above.
  // For other non-invoice event types, mark here.
  if (event.type !== 'invoice.payment_succeeded') {
    markStripeEventProcessed(event.id);
  }
  return c.json({ received: true });
});