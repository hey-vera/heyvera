import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3402),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'openclaw']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENCLAW_API_URL: z.string().default('http://localhost:3000'),
  OPENCLAW_API_KEY: z.string().optional(),

  CLAWAPIS_BASE_URL: z.string().default('https://api.clawapis.com'),
  CLAWAPIS_API_KEY: z.string().optional(),

  REDIS_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  CACHE_MAX_MEMORY_ITEMS: z.coerce.number().default(10000),

  MARKUP_PERCENT: z.coerce.number().default(15),
  TREASURY_WALLET: z.string().optional(),

  API_KEYS: z.string().optional(),
  ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters').optional(),
  PLATFORM_SIGNING_SECRET: z.string().optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(60),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),

  SOLANA_PRIVATE_KEY: z.string().optional(),
  X402_X_API_URL: z.string().default('https://clawapis.com'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),

  CLERK_SECRET_KEY: z.string().optional(),
  SOLANA_RECEIVING_WALLET: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address').optional(),
  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  ADMIN_EMAIL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isSimulationMode = !env.CLAWAPIS_API_KEY;

// Production safety guard — warn loudly if critical secrets are missing
if (env.NODE_ENV === 'production') {
  const missing: string[] = [];
  if (!env.ADMIN_API_KEY) missing.push('ADMIN_API_KEY');
  if (!env.PLATFORM_SIGNING_SECRET) missing.push('PLATFORM_SIGNING_SECRET');
  if (!env.CLERK_SECRET_KEY) missing.push('CLERK_SECRET_KEY');
  if (isSimulationMode) missing.push('CLAWAPIS_API_KEY (simulation mode active — real API calls disabled)');
  // Warn if the configured LLM provider has no API key
  if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY (LLM_PROVIDER=anthropic but key is missing)');
  if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY (LLM_PROVIDER=openai but key is missing)');
  if (env.LLM_PROVIDER === 'openclaw' && !env.OPENCLAW_API_KEY) missing.push('OPENCLAW_API_KEY (LLM_PROVIDER=openclaw but key is missing)');
  if (missing.length > 0) {
    console.warn('⚠️  Production warning — missing recommended env vars:', missing.join(', '));
  }
}