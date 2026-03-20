/**
 * ClawNet XMTP Bot
 *
 * Encrypted messaging integration for agent-to-agent and user-to-agent
 * ClawNet interactions via XMTP protocol.
 *
 * Design principles (mirrors Telegram bot):
 * - User-driven ONLY: no automatic scheduled queries.
 * - Global 12h cooldown: max 1 heavy query per 12h across ALL users.
 * - Results broadcast to subscribers so they benefit from each query.
 * - /price is exempt from the global cooldown (lightweight, per-address 1/min).
 * - /skill shows skill info but does NOT invoke — avoids credit bypass.
 * - Subscribers persisted in SQLite (survives restarts).
 *
 * Uses dynamic import for @xmtp/node-sdk — the integration gracefully
 * degrades if the package is not installed.
 */
import { logger } from '../utils/logger';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse, FormattedResponse } from '../core/formatter';
import { apiRegistry } from '../config/api-registry';
import {
  listPublicSkills, getSkill,
  addXmtpSubscriber, removeXmtpSubscriber,
  getXmtpSubscribers, isXmtpSubscriber,
} from '../db/index';
import { env } from '../config/index';

// XMTP client instance — set after successful init
let xmtpClient: any = null;

// ─── Input sanitization ───────────────────────────────────────────────────────

/** Strip control characters and hard-cap length. Prevents prompt injection
 *  from malicious users passing crafted input. */
function sanitizeInput(raw: string, maxLen = 300): string {
  const normalized = raw.normalize('NFKC');
  return normalized
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '')
    .trim()
    .slice(0, maxLen);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const GLOBAL_COOLDOWN_MS = 12 * 60 * 60 * 1000;
let lastGlobalQuery = 0;

function isOnCooldown(): boolean {
  return Date.now() - lastGlobalQuery < GLOBAL_COOLDOWN_MS;
}

function cooldownRemaining(): string {
  const remainMs = GLOBAL_COOLDOWN_MS - (Date.now() - lastGlobalQuery);
  const h = Math.floor(remainMs / 3_600_000);
  const m = Math.floor((remainMs % 3_600_000) / 60_000);
  const ready = new Date(Date.now() + remainMs);
  const timeStr = ready.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return h > 0 ? `${h}h ${m}m (ready at ${timeStr} UTC)` : `${m}m (ready at ${timeStr} UTC)`;
}

function setCooldown(): void {
  lastGlobalQuery = Date.now();
}

// Per-address price cooldown: 1 per minute
const priceCooldowns = new Map<string, number>();
const PRICE_COOLDOWN_MS = 60_000;

// Purge stale cooldown entries every 5 minutes
const cooldownPurgeInterval = setInterval(() => {
  const cutoff = Date.now() - PRICE_COOLDOWN_MS;
  for (const [addr, ts] of priceCooldowns.entries()) {
    if (ts < cutoff) priceCooldowns.delete(addr);
  }
}, 5 * 60 * 1000);
cooldownPurgeInterval.unref();

// ─── Allowlist ────────────────────────────────────────────────────────────────

const ALLOWED_ADDRESSES: Set<string> = (() => {
  const raw = env.XMTP_ALLOWED_ADDRESSES ?? '';
  if (!raw.trim()) return new Set<string>();
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
})();

function isAllowedAddress(address: string): boolean {
  return ALLOWED_ADDRESSES.size === 0 || ALLOWED_ADDRESSES.has(address.toLowerCase());
}

// ─── Plain-text formatting (XMTP has no HTML mode) ───────────────────────────

function scoreBar(score: number, outOf = 100): string {
  const filled = Math.min(8, Math.max(0, Math.round((score / outOf) * 8)));
  return '\u2588'.repeat(filled) + '\u2591'.repeat(8 - filled);
}

function formatForXmtp(result: FormattedResponse, durationMs: number, label?: string): string {
  const parts: string[] = [];

  if (label) parts.push(`${label}\n`);

  const scores: string[] = [];
  if (result.opportunityScore !== undefined) {
    scores.push(`Opportunity ${result.opportunityScore}/100\n${scoreBar(result.opportunityScore)}`);
  }
  if (result.riskScore !== undefined) {
    scores.push(`Risk ${result.riskScore}/100\n${scoreBar(result.riskScore)}`);
  }
  if (scores.length) parts.push(scores.join('\n') + '\n');

  parts.push(result.answer);

  if (result.suggestedActions.length > 0) {
    parts.push('\nActions:');
    for (const action of result.suggestedActions) {
      parts.push(`> ${action}`);
    }
  }

  parts.push(`\n-- ${durationMs}ms | ClawNet`);

  const msg = parts.join('\n');
  return msg.length > 4000 ? msg.slice(0, 3980) + '\n...truncated' : msg;
}

// ─── Demo query rotation ─────────────────────────────────────────────────────

function buildDemoQueries(): string[] {
  const categories = [...new Set(apiRegistry.map((e) => e.category))];
  const hasSolana = categories.includes('solana');
  const hasSocial = categories.includes('social');
  const hasUtility = categories.includes('utility');
  const hasDefi = categories.includes('defi');

  const queries: string[] = [];

  if (hasSolana) {
    queries.push(
      'Analyze the top 3 trending Solana tokens right now. For each: current price, 24h change, risk score, and a one-line verdict. Which has the best risk/reward?',
      'Which trending Solana tokens have the highest rug pull risk right now? Show risk scores and specific red flags for each.',
    );
  }
  if (hasSocial) {
    queries.push(
      'What tokens are getting the most buzz on Twitter and Reddit right now? Show sentiment scores and whether the hype matches on-chain data.',
    );
  }
  if (hasUtility) {
    queries.push(
      'What are the top 5 Solana and crypto news stories right now? For each, give a one-line summary and its likely market impact.',
    );
  }
  if (hasDefi) {
    queries.push(
      'What are the best risk-adjusted yield opportunities in Solana DeFi right now? Compare lending rates and LP APYs.',
    );
  }
  if (hasSolana && hasSocial) {
    queries.push(
      'Cross-reference the top trending Solana tokens with their social sentiment and risk scores. Which has the strongest overall signal?',
    );
  }
  if (queries.length === 0) {
    queries.push('Give me a current overview of the Solana ecosystem: top tokens, market mood, and key developments this week.');
  }
  return queries;
}

const DEMO_QUERIES = buildDemoQueries();
let demoIndex = 0;

function nextDemoQuery(): string {
  const q = DEMO_QUERIES[demoIndex % DEMO_QUERIES.length];
  demoIndex++;
  return q;
}

// ─── Core orchestration helper ────────────────────────────────────────────────

async function runQuery(query: string): Promise<{ result: FormattedResponse; durationMs: number }> {
  const start = Date.now();
  const intent = await parseIntent(query);
  const execution = await executePlan(intent);
  const result = await formatResponse(query, intent, execution);
  return { result, durationMs: Date.now() - start };
}

// ─── Help & About text ────────────────────────────────────────────────────────

function buildHelp(): string {
  const categories = [...new Set(apiRegistry.map((e) => e.category))];
  const endpointCount = apiRegistry.length;

  return (
    `ClawNet -- Live AI analysis across ${endpointCount} endpoints\n` +
    `Data sources: ${categories.slice(0, 8).join(', ')}${categories.length > 8 ? ', +more' : ''}\n\n` +
    `INSTANT (no cooldown):\n` +
    `/price <token> -- Quick price check (1/min per address)\n` +
    `/skills -- Browse the skill marketplace\n` +
    `/skill <id> -- View skill details\n` +
    `/status -- Bot health & your subscription status\n` +
    `/about -- What is ClawNet\n\n` +
    `ANALYSIS (1 per 12h, shared global cooldown):\n` +
    `/demo -- Run a live showcase analysis\n` +
    `/trending -- Top Solana tokens by momentum\n` +
    `/analyze <token> -- Deep price/risk/sentiment dive\n` +
    `/sentiment <token> -- Twitter & Reddit sentiment\n` +
    `/news <topic> -- Latest news digest\n` +
    `/ask <question> -- Freeform question\n\n` +
    `/subscribe -- Receive analysis results in this conversation\n` +
    `/unsubscribe -- Stop receiving results\n\n` +
    `Analysis commands share a 12h global cooldown (max 2/day). Results are broadcast to all subscribers.`
  );
}

function buildAbout(): string {
  const endpointCount = apiRegistry.length;
  const skillCount = listPublicSkills().length;
  return (
    `ClawNet -- Sovereign AI Orchestration\n\n` +
    `ClawNet routes natural language queries through ${endpointCount} real-time data endpoints -- Solana blockchain, DeFi protocols, social sentiment, crypto news, and more -- then synthesizes everything into a structured intelligence report.\n\n` +
    `Platform stats:\n` +
    `- ${endpointCount} live data endpoints\n` +
    `- ${skillCount} published skills in the marketplace\n` +
    `- Credits-based pricing (no subscription required)\n` +
    `- 85% revenue share for skill creators\n\n` +
    `Get started:\n` +
    `- API + docs: https://claw-net.org\n` +
    `- Skill marketplace: https://claw-net.org/marketplace\n\n` +
    `Type /demo to see a live analysis, or /help for all commands.`
  );
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(senderAddress: string, content: string): Promise<string> {
  if (!isAllowedAddress(senderAddress)) {
    if (ALLOWED_ADDRESSES.size > 0) return 'Unauthorized.';
    // If no allowlist set, fall through
  }

  const input = sanitizeInput(content);
  if (!input) return '';

  // Command routing
  if (input.startsWith('/help') || input.startsWith('/start')) return buildHelp();
  if (input.startsWith('/about')) return buildAbout();

  if (input.startsWith('/status')) {
    const subscribed = isXmtpSubscriber(senderAddress);
    const subscriberCount = getXmtpSubscribers().length;
    const endpointCount = apiRegistry.length;
    const skillCount = listPublicSkills().length;
    const cooldownStatus = isOnCooldown()
      ? `Active -- resets in ${cooldownRemaining()}`
      : 'Ready -- next query available now';

    return (
      `ClawNet Status\n\n` +
      `Subscription: ${subscribed ? 'Subscribed' : 'Not subscribed'}\n` +
      `Subscribers: ${subscriberCount}\n` +
      `Endpoints: ${endpointCount}\n` +
      `Public skills: ${skillCount}\n` +
      `Global cooldown: ${cooldownStatus}\n` +
      `Mode: ${env.NODE_ENV}`
    );
  }

  if (input.startsWith('/subscribe')) {
    if (isXmtpSubscriber(senderAddress)) {
      return 'Already subscribed. You\'ll receive analysis results whenever a live query runs (up to 2x/day).';
    }
    addXmtpSubscriber(senderAddress);
    logger.info({ address: senderAddress }, 'New XMTP subscriber');
    return 'Subscribed! You\'ll receive ClawNet analysis results whenever a live query runs (up to 2x per day). Use /help to see on-demand commands.';
  }

  if (input.startsWith('/unsubscribe')) {
    if (!isXmtpSubscriber(senderAddress)) {
      return 'You\'re not subscribed. Use /subscribe to join.';
    }
    removeXmtpSubscriber(senderAddress);
    return 'Unsubscribed. On-demand commands still work anytime.';
  }

  if (input.startsWith('/skills')) {
    const skills = listPublicSkills();
    if (skills.length === 0) return 'No public skills yet. Visit claw-net.org/marketplace to publish one.';
    const lines: string[] = [`ClawHub Skills (${skills.length} total)\n`];
    for (const s of skills.slice(0, 12)) {
      lines.push(`[${s.id}] ${s.name} -- ${s.credit_cost}cr`);
      lines.push(`  ${s.description.slice(0, 70)}${s.description.length > 70 ? '...' : ''}`);
    }
    if (skills.length > 12) lines.push(`\n...and ${skills.length - 12} more at claw-net.org/marketplace`);
    lines.push('\nUse /skill <id> to view a skill\'s details.');
    return lines.join('\n');
  }

  if (input.startsWith('/skill ')) {
    const skillId = sanitizeInput(input.slice(7).split(/\s+/)[0] ?? '', 50);
    if (!skillId) return 'Usage: /skill <id>\n\nGet skill IDs from /skills';

    const skill = getSkill(skillId);
    if (!skill || !skill.public) return 'Skill not found. Use /skills to see available skills.';

    let vars: string[] = [];
    try {
      const matches = skill.prompt_template.match(/\{\{(\w+)\}\}/g) ?? [];
      vars = [...new Set(matches.map((m: string) => m.slice(2, -2)))];
    } catch { /* ignore */ }

    return (
      `${skill.name}\n` +
      `ID: ${skill.id}\n\n` +
      `${skill.description}\n\n` +
      `Cost: ${skill.credit_cost} credits\n` +
      `Uses: ${skill.uses}\n` +
      (vars.length ? `Variables: ${vars.join(', ')}\n\n` : '\n') +
      `Invoke via API:\n` +
      `POST /v1/marketplace/skills/${skill.id}/purchase\n\n` +
      `View on marketplace: https://claw-net.org/marketplace#skill/${encodeURIComponent(skill.id)}`
    );
  }

  if (input.startsWith('/price ')) {
    const token = sanitizeInput(input.slice(7), 50);
    if (!token) return 'Usage: /price <token symbol or mint address>\n\nExample: /price SOL';
    const lastPrice = priceCooldowns.get(senderAddress) ?? 0;
    if (Date.now() - lastPrice < PRICE_COOLDOWN_MS) {
      return '/price is limited to once per minute. Try again shortly.';
    }
    priceCooldowns.set(senderAddress, Date.now());
    try {
      const { result, durationMs } = await runQuery(
        `Get the current price, 24h change, volume, and market cap for ${token.toUpperCase()}. Keep it brief and factual.`
      );
      return formatForXmtp(result, durationMs, `Price: ${token.toUpperCase()}`);
    } catch (err) {
      logger.error({ err, query: `/price ${token}` }, 'XMTP price query failed');
      return 'Something went wrong fetching the price. Try again shortly.';
    }
  }

  if (input.startsWith('/demo')) {
    if (isOnCooldown()) return `Global cooldown active.\n\nClawNet runs 1 live analysis per 12 hours (shared across all users).\n\nNext query available in ${cooldownRemaining()}.`;
    setCooldown();
    const query = nextDemoQuery();
    return await runAndBroadcast(senderAddress, query, 'ClawNet Live Demo');
  }

  if (input.startsWith('/trending')) {
    if (isOnCooldown()) return `Global cooldown active. Next query in ${cooldownRemaining()}.`;
    setCooldown();
    return await runAndBroadcast(
      senderAddress,
      'Analyze the top trending Solana tokens right now. Show price, 24h change, risk score, and holder concentration for each. Rank by opportunity score.',
      'Trending Now',
    );
  }

  if (input.startsWith('/analyze ')) {
    const raw = sanitizeInput(input.slice(9), 100);
    if (!raw) return 'Usage: /analyze <token symbol or mint address>\n\nExample: /analyze BONK';
    if (isOnCooldown()) return `Global cooldown active. Next query in ${cooldownRemaining()}.`;
    setCooldown();
    const isAddress = raw.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(raw);
    const query = isAddress
      ? `Full analysis of Solana token at mint address ${raw}: price, 24h change, risk score, holder distribution, and social sentiment.`
      : `Full analysis of the Solana token ${raw.toUpperCase()}: current price, 24h change, risk score, top holder concentration, and social sentiment. Give a final verdict.`;
    return await runAndBroadcast(senderAddress, query, `Analysis: ${raw.toUpperCase()}`);
  }

  if (input.startsWith('/sentiment ')) {
    const token = sanitizeInput(input.slice(11), 50);
    if (!token) return 'Usage: /sentiment <token symbol>\n\nExample: /sentiment SOL';
    if (isOnCooldown()) return `Global cooldown active. Next query in ${cooldownRemaining()}.`;
    setCooldown();
    return await runAndBroadcast(
      senderAddress,
      `Analyze Twitter and Reddit sentiment for ${token.toUpperCase()}. Show mention count, sentiment score, top posts, and whether the community is bullish or bearish.`,
      `Sentiment: ${token.toUpperCase()}`,
    );
  }

  if (input.startsWith('/news')) {
    const topic = sanitizeInput(input.slice(5).trim() || 'Solana crypto', 100);
    if (isOnCooldown()) return `Global cooldown active. Next query in ${cooldownRemaining()}.`;
    setCooldown();
    return await runAndBroadcast(
      senderAddress,
      `Find the latest news about ${topic}. Summarize the top 5 stories and explain the likely market impact of each.`,
      `News: ${topic}`,
    );
  }

  if (input.startsWith('/ask ')) {
    const question = sanitizeInput(input.slice(5), 300);
    if (!question) return 'Usage: /ask <your question>\n\nOr just type your question directly.';
    if (isOnCooldown()) return `Global cooldown active. Next query in ${cooldownRemaining()}.`;
    setCooldown();
    return await runAndBroadcast(senderAddress, question, 'ClawNet');
  }

  // Default: plain text → treat as a query
  if (input.startsWith('/')) return 'Unknown command. Type /help for available commands.';
  if (input.length < 5) return '';
  if (input.length > 500) return 'Query too long. Please keep it under 500 characters.';
  if (isOnCooldown()) return `Global cooldown active.\n\nNext query available in ${cooldownRemaining()}.`;
  setCooldown();
  return await runAndBroadcast(senderAddress, sanitizeInput(input, 500), 'ClawNet');
}

// ─── Run query + broadcast to subscribers ─────────────────────────────────────

async function runAndBroadcast(senderAddress: string, query: string, label: string): Promise<string> {
  try {
    const { result, durationMs } = await runQuery(query);
    const formatted = formatForXmtp(result, durationMs, label);

    // Broadcast to other subscribers
    const targets = getXmtpSubscribers().filter((addr) => addr.toLowerCase() !== senderAddress.toLowerCase());
    if (targets.length > 0) {
      broadcastToSubscribers(targets, formatted).catch((err) => {
        logger.warn({ err }, 'XMTP broadcast failed');
      });
    }

    return formatted;
  } catch (err) {
    logger.error({ err, query: query.slice(0, 100) }, 'XMTP query failed');
    return 'Something went wrong running that query. The service may be briefly unavailable -- try again after the cooldown resets.';
  }
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

async function broadcastToSubscribers(addresses: string[], message: string): Promise<void> {
  if (!xmtpClient) return;

  const BATCH_SIZE = 5;
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (address) => {
        try {
          await sendXmtpMessage(address, message);
        } catch (err) {
          logger.warn({ address, err }, 'XMTP: failed to send to subscriber');
          // Remove dead subscriber
          try { removeXmtpSubscriber(address); } catch { /* ignore */ }
        }
      })
    );
    if (i + BATCH_SIZE < addresses.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// ─── XMTP message sending (abstracted for SDK flexibility) ───────────────────

async function sendXmtpMessage(peerAddress: string, content: string): Promise<void> {
  if (!xmtpClient) throw new Error('XMTP client not initialized');

  try {
    const conversation = await xmtpClient.conversations.newConversation(peerAddress);
    await conversation.send(content);
  } catch (err) {
    logger.error({ err, peerAddress }, 'XMTP: failed to send message');
    throw err;
  }
}

// ─── Bot init ─────────────────────────────────────────────────────────────────

export async function initXmtp(): Promise<void> {
  if (!env.XMTP_BOT_PRIVATE_KEY) {
    logger.info('XMTP bot disabled (missing XMTP_BOT_PRIVATE_KEY)');
    return;
  }

  if (env.NODE_ENV !== 'production') {
    logger.info('XMTP bot disabled in non-production environment');
    return;
  }

  try {
    // Dynamic import to avoid requiring the package when not configured
    // @ts-ignore — @xmtp/node-sdk is an optional runtime dependency
    const xmtpSdk = await import('@xmtp/node-sdk');
    const { Client } = xmtpSdk;

    // Create signing key from the private key env var
    // The key format depends on the XMTP SDK version — hex-encoded private key
    const keyBytes = hexToBytes(env.XMTP_BOT_PRIVATE_KEY);

    xmtpClient = await Client.create(keyBytes, {
      env: 'production',
    });

    logger.info({ address: xmtpClient.accountAddress }, 'XMTP client created');

    // Stream incoming messages
    const stream = await xmtpClient.conversations.streamAllMessages();

    // Process messages in background
    (async () => {
      try {
        for await (const message of stream) {
          // Skip messages from ourselves
          if (message.senderAddress === xmtpClient.accountAddress) continue;
          // Skip non-text messages
          if (typeof message.content !== 'string') continue;

          const senderAddress = message.senderAddress;
          try {
            const reply = await handleMessage(senderAddress, message.content);
            if (reply) {
              await sendXmtpMessage(senderAddress, reply);
            }
          } catch (err) {
            logger.error({ err, sender: senderAddress }, 'XMTP: message handler error');
          }
        }
      } catch (err) {
        logger.error({ err }, 'XMTP: message stream error — bot stopped');
      }
    })();

    const subs = getXmtpSubscribers().length;
    logger.info({ subscribers: subs, demoQueries: DEMO_QUERIES.length }, 'XMTP bot started');

  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
      logger.warn('[xmtp] @xmtp/node-sdk not installed, skipping XMTP integration');
      logger.warn('[xmtp] Install with: npm install @xmtp/node-sdk');
    } else {
      logger.error({ err }, 'Failed to initialize XMTP bot');
    }
  }
}

// ─── External broadcast (called by other modules) ─────────────────────────────

export async function sendXmtpAlert(message: string): Promise<void> {
  if (!xmtpClient) return;
  const subscribers = getXmtpSubscribers();
  if (subscribers.length === 0) return;

  await broadcastToSubscribers(subscribers, message);
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

export async function stopXmtp(): Promise<void> {
  if (xmtpClient) {
    try {
      // Close conversations stream gracefully
      xmtpClient = null;
      logger.info('XMTP bot stopped');
    } catch (err) {
      logger.warn({ err }, 'Error stopping XMTP bot');
    }
  }
}

// ─── Hex-to-bytes utility (avoid importing ethers just for this) ──────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}
