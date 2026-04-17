import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3402),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'openclaw']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENCLAW_API_URL: z.string().default('http://localhost:3000'),
  OPENCLAW_API_KEY: z.string().optional(),

  CLAWAPIS_BASE_URL: z.string().default('https://api.clawapis.com'),
  CLAWAPIS_API_KEY: z.string().default('your-clawapis-key'),

  REDIS_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  CACHE_MAX_MEMORY_ITEMS: z.coerce.number().default(10000),

  MARKUP_PERCENT: z.coerce.number().default(15),
  TREASURY_WALLET: z.string().optional(),

  API_KEYS: z.string().optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(60),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),

  // ─── Persistent storage ───────────────────────────────────────────────────
  // Path to the SQLite database file. Consumed by `src/db/connection.ts`.
  // Default is repo-relative `./data/orchestrator.db` to match the filename
  // already used in production — the live VPS database is `data/orchestrator.db`
  // and the backup/restore tooling is aligned around that name, so we pick
  // the same default here to keep runtime, backup, and restore naming in lockstep.
  // In Docker this path lands inside the bind-mounted `./data` volume defined
  // in docker-compose.yml, so the database survives container rebuilds.
  DB_PATH: z.string().default('./data/orchestrator.db'),

  // ─── Credential vault (secret-at-rest) ────────────────────────────────────
  // Base64-encoded 32-byte key-encryption-key that wraps stored secrets via
  // AES-256-GCM. Consumed by `src/core/vault-crypto.ts`. Optional at this
  // stage: when unset, `encryptSecret` falls back to a plain base64 passthrough
  // and logs a one-time warning, so existing deployments keep running.
  // Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  CREDENTIAL_VAULT_KEK: z.string().optional(),

  // ─── Clerk authentication ──────────────────────────────────────────────────
  CLERK_SECRET_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isSimulationMode =
  !env.CLAWAPIS_API_KEY || env.CLAWAPIS_API_KEY === 'your-clawapis-key';