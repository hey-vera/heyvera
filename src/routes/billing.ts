// src/routes/billing.ts — Flexible credit top-up via Stripe Checkout Session
// Replaces fixed payment links with a single endpoint that accepts any amount $5–$10,000.
import { Hono } from 'hono';
import Stripe from 'stripe';
import { requireClerkAuth } from '../middleware/clerk-auth';
import { logger } from '../utils/logger';
import { env } from '../config/index';
import { getApiKeyByClerkId, getApiKeyByEmail } from '../db/index';
import { round6 } from '../core/credits';

export const billingRouter = new Hono();

// ── Credit calculation ─────────────────────────────────────────────────────
// Tiered bonus: larger top-ups get a better rate (incentive without restriction).
// Same curve as the old fixed packages, but now works for any amount.
//   $5–$19:   base rate   (1000 cr/$)
//   $20–$49:  +10%        (1100 cr/$)
//   $50–$99:  +20%        (1200 cr/$)
//   $100–$499: +25%       (1250 cr/$)
//   $500–$999: +50%       (1500 cr/$)
//   $1000+:   +100%       (2000 cr/$)
const TIERS = [
  { min: 1000, rate: 2000 },
  { min: 500,  rate: 1500 },
  { min: 100,  rate: 1250 },
  { min: 50,   rate: 1200 },
  { min: 20,   rate: 1100 },
  { min: 5,    rate: 1000 },
] as const;

export function creditsForDollars(dollars: number): number {
  for (const tier of TIERS) {
    if (dollars >= tier.min) return round6(dollars * tier.rate);
  }
  return round6(dollars * 1000); // fallback
}

// Same tiers but +7% for USDC (no Stripe fees)
const USDC_BONUS = 1.07;
export function creditsForDollarsUsdc(dollars: number): number {
  return round6(creditsForDollars(dollars) * USDC_BONUS);
}

// ── POST /v1/billing/checkout ──────────────────────────────────────────────
// Creates a Stripe Checkout Session with a dynamic amount.
// Returns { url } — the frontend redirects the user there.
billingRouter.post('/checkout', requireClerkAuth, async (c) => {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return c.json({ error: 'Stripe not configured', code: 'STRIPE_NOT_CONFIGURED' }, 503);
  }

  let body: { amount?: number };
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 5 || amount > 10000) {
    return c.json({ error: 'Amount must be an integer between $5 and $10,000', code: 'INVALID_AMOUNT' }, 400);
  }

  const clerkUserId = c.get('clerkUserId');
  const clerkEmail = c.get('clerkEmail') ?? '';
  const credits = creditsForDollars(amount);

  const stripe = new Stripe(stripeSecretKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: clerkUserId,
      customer_email: clerkEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${credits.toLocaleString()} ClawNet Credits`,
            description: `$${amount} top-up — ${credits.toLocaleString()} credits at ${Math.round(credits / amount).toLocaleString()} cr/$`,
          },
          unit_amount: amount * 100, // cents
        },
        quantity: 1,
      }],
      metadata: {
        clerkUserId,
        credits: String(credits),
        source: 'flexible_checkout',
      },
      success_url: 'https://claw-net.org/dashboard?topup=success',
      cancel_url: 'https://claw-net.org/dashboard?topup=cancelled',
    });

    logger.info({ clerkUserId, amount, credits, sessionId: session.id }, 'Stripe checkout session created');

    return c.json({ url: session.url, credits, sessionId: session.id });
  } catch (err) {
    logger.error({ err }, 'Failed to create Stripe checkout session');
    return c.json({ error: 'Failed to create checkout session', code: 'STRIPE_ERROR' }, 500);
  }
});

// ── GET /v1/billing/estimate ───────────────────────────────────────────────
// Returns credit estimate for a given dollar amount (no auth required).
// Used by the dashboard UI to show live credit count as the user types.
billingRouter.get('/estimate', (c) => {
  const raw = c.req.query('amount');
  const amount = parseInt(raw ?? '', 10);
  if (isNaN(amount) || amount < 1 || amount > 10000) {
    return c.json({ error: 'Amount must be between 1 and 10000', code: 'INVALID_AMOUNT' }, 400);
  }

  const cardCredits = creditsForDollars(amount);
  const usdcCredits = creditsForDollarsUsdc(amount);

  // Find current tier info
  let bonusPct = 0;
  let nextTierAt: number | null = null;
  let nextTierBonus: string | null = null;
  for (let i = 0; i < TIERS.length; i++) {
    if (amount >= TIERS[i].min) {
      bonusPct = Math.round((TIERS[i].rate / 1000 - 1) * 100);
      if (i > 0) {
        nextTierAt = TIERS[i - 1].min;
        nextTierBonus = `+${Math.round((TIERS[i - 1].rate / 1000 - 1) * 100)}%`;
      }
      break;
    }
  }

  return c.json({
    amount,
    card: { credits: cardCredits, rate: Math.round(cardCredits / amount) },
    usdc: { credits: usdcCredits, rate: Math.round(usdcCredits / amount) },
    bonusPct,
    nextTierAt,
    nextTierBonus,
  });
});
