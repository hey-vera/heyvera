import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3402),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'openclaw']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  ANTHROPIC_INTENT_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_INTENT_MODEL: z.string().default('gpt-4o-mini'),
  OPENCLAW_API_URL: z.string().default('http://localhost:3000'),
  OPENCLAW_API_KEY: z.string().optional(),

  CLAWAPIS_BASE_URL: z.string().default('https://clawapis.com'),

  REDIS_URL: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  CACHE_MAX_MEMORY_ITEMS: z.coerce.number().default(10000),

  CREDITS_PER_USD: z.coerce.number().int().min(100).max(100000).default(1000),

  API_KEYS: z.string().optional(),
  ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters').optional(),
  PLATFORM_SIGNING_SECRET: z.string().optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(10000).default(60),
  FREE_TRIAL_CREDITS: z.coerce.number().int().min(0).max(10000).default(0),
  REFERRAL_BONUS_RECEIVER: z.coerce.number().int().min(0).max(10000).default(500), // credits granted to the user who applies a referral code
  REFERRAL_BONUS_OWNER: z.coerce.number().int().min(0).max(10000).default(250),    // credits granted to the referral code owner
  DAILY_SPEND_CAP: z.coerce.number().int().min(0).default(0),          // 0 = disabled (agents should spend freely until credits run out)
  ANOMALY_THRESHOLD: z.coerce.number().int().min(100).default(5000),  // alert admin when a key hits this in one day

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),

  SOLANA_PRIVATE_KEY: z.string().optional(),
  EVM_PRIVATE_KEY: z.string().optional(), // Base/EVM wallet private key for paying x402 APIs on Base chain
  X402_X_API_URL: z.string().default('https://clawapis.com'),

  // x402 provider mode (serve skills as x402 endpoints)
  X402_FACILITATOR_URL: z.string().default('https://x402.org/facilitator'),
  X402_NETWORK: z.enum(['base-mainnet', 'base-sepolia']).default('base-mainnet'),
  X402_RECIPIENT_ADDRESS: z.string().optional(), // EVM address to receive USDC on Base
  X402_USDC_PER_CREDIT: z.coerce.number().default(0.001), // 1 credit = $0.001 USDC (matches Stripe base rate of 1000 credits/$1)

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),

  CLERK_SECRET_KEY: z.string().optional(),
  ADMIN_CLERK_IDS: z.string().optional(), // Comma-separated Clerk user IDs allowed to resolve escrow disputes
  SOLANA_RECEIVING_WALLET: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address').optional(),
  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  SOLANA_RPC_FALLBACK: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(), // Comma-separated emails with admin dashboard access
  SENTRY_DSN: z.string().optional(),

  // Hot wallet (same key as SOLANA_PRIVATE_KEY in 2-wallet setup)
  PLATFORM_PAYOUT_PRIVATE_KEY: z.string().optional(), // bs58 Solana private key — used by payout cron to send USDC
  PAYOUT_USDC_PER_CREDIT: z.coerce.number().default(0.00075), // 25% below buy rate ($0.001) — prevents arbitrage
  BASE_RPC_URL: z.string().optional(), // Optional custom Base RPC (defaults to public mainnet.base.org)

  // Treasury auto-sweep (optional — with 2-wallet setup, treasury credits are pure profit)
  TREASURY_SWEEP_WALLET: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address').optional(),
  TREASURY_SWEEP_MIN: z.coerce.number().int().min(100).default(10000), // minimum credits to trigger sweep (10000 = $10 at $0.001/cr)
  HOT_WALLET_LOW_BALANCE_USDC: z.coerce.number().default(50), // Email alert when hot wallet drops below this
  HOT_WALLET_LOW_SOL: z.coerce.number().default(0.1),         // Email alert when SOL (gas) drops below this

  // Pricing engine — previously raw parseInt, now Zod-validated with bounds
  COST_MARKUP_FACTOR: z.coerce.number().int().min(500).max(10000).default(1500), // 1000=break-even, 1500=33-50% margin
  ORCHESTRATION_FEE: z.coerce.number().int().min(0).max(100).default(2),         // flat credits per LLM-routed query
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
// Simulation mode: real API calls only when SOLANA_PRIVATE_KEY is set (x402-solana payment provider)
export const isSimulationMode = !env.SOLANA_PRIVATE_KEY;

// Swarm base fee — deducted upfront before sub-task budget; shared by swarm.ts and openclaw.ts
export const SWARM_BASE_FEE = 20;

// Orchestration fee — now Zod-validated (min 0, max 100)
export const ORCHESTRATION_FEE = env.ORCHESTRATION_FEE;

// Tiered per-minute rate limit based on lifetime spend
export function rateTier(amountPaid: number): { label: string; perMinute: number } {
  if (amountPaid >= 500) return { label: '$500+', perMinute: 300 };
  if (amountPaid >= 100) return { label: '$100+', perMinute: 120 };
  if (amountPaid >= 20)  return { label: '$20+',  perMinute: 60  };
  return { label: 'free', perMinute: 30 };
}

// Production safety guard — block startup for security-critical secrets, warn for others
if (env.NODE_ENV === 'production') {
  // ADMIN_API_KEY must be present: without it, all /v1/admin routes are wide open
  if (!env.ADMIN_API_KEY) {
    console.error('❌ FATAL: ADMIN_API_KEY is not set in production — admin routes unprotected. Exiting.');
    process.exit(1);
  }

  if (!env.ADMIN_CLERK_IDS) {
    console.warn('⚠️  ADMIN_CLERK_IDS not set — escrow dispute resolution will be unavailable');
  }

  const warnings: string[] = [];
  if (!env.PLATFORM_SIGNING_SECRET) warnings.push('PLATFORM_SIGNING_SECRET (response signing disabled)');
  if (!env.CLERK_SECRET_KEY) warnings.push('CLERK_SECRET_KEY');
  if (isSimulationMode) warnings.push('SOLANA_PRIVATE_KEY (simulation mode active — real x402 API calls disabled)');
  // Warn if the configured LLM provider has no API key
  if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) warnings.push('ANTHROPIC_API_KEY (LLM_PROVIDER=anthropic but key is missing)');
  if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) warnings.push('OPENAI_API_KEY (LLM_PROVIDER=openai but key is missing)');
  if (env.LLM_PROVIDER === 'openclaw' && !env.OPENCLAW_API_KEY) warnings.push('OPENCLAW_API_KEY (LLM_PROVIDER=openclaw but key is missing)');
  if (warnings.length > 0) {
    console.warn('⚠️  Production warning — missing recommended env vars:', warnings.join(', '));
  }
}