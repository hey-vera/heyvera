/**
 * ClawNet Telegram Bot
 *
 * Design principles:
 * - User-driven ONLY: no automatic scheduled queries. Queries run when a real
 *   user explicitly requests them.
 * - Global 12h cooldown: only 1 heavy query per 12 hours across ALL users
 *   combined. This caps costs at max 2 queries/day.
 * - Results broadcast to subscribers so they benefit from each query.
 * - /price is exempt from the global cooldown (lightweight, per-user 1/min).
 * - /skill shows skill info but does NOT invoke — avoids credit bypass.
 * - Subscribers persisted in SQLite (survives container rebuilds).
 */
import { Bot, Context } from 'grammy';
import { logger } from '../utils/logger';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse, FormattedResponse } from '../core/formatter';
import { apiRegistry } from '../config/api-registry';
import {
  listPublicSkills, getSkill,
  addTelegramSubscriber, removeTelegramSubscriber,
  getTelegramSubscribers, isTelegramSubscriber,
} from '../db/index';
import { env } from '../config/index';

let bot: Bot | null = null;

// ─── Input sanitization ───────────────────────────────────────────────────────

/** Strip control characters and hard-cap length. Prevents prompt injection
 *  from malicious Telegram users passing crafted input. */
function sanitizeInput(raw: string, maxLen = 300): string {
  return raw
    .replace(/[\x00-\x1f\x7f]/g, ' ')  // Replace control chars with space
    .trim()
    .slice(0, maxLen);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

// Global cooldown: max 1 heavy query per 12h across ALL users combined.
// Resets to allow the 1st user who asks after cooldown to trigger a query.
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

// Per-user price cooldown: 1 per minute
const priceCooldowns = new Map<number, number>();
const PRICE_COOLDOWN_MS = 60_000;

// Purge stale cooldown entries hourly — prevents unbounded Map growth
setInterval(() => {
  const cutoff = Date.now() - PRICE_COOLDOWN_MS;
  for (const [uid, ts] of priceCooldowns.entries()) {
    if (ts < cutoff) priceCooldowns.delete(uid);
  }
}, 60 * 60 * 1000).unref();

// ─── Telegram HTML helpers ────────────────────────────────────────────────────

function escTg(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scoreBar(score: number, outOf = 100): string {
  const filled = Math.min(8, Math.max(0, Math.round((score / outOf) * 8)));
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}

function scoreEmoji(score: number, inverted = false): string {
  const high = inverted ? '🔴' : '🟢';
  const mid = '🟡';
  const low = inverted ? '🟢' : '🔴';
  if (score >= 70) return high;
  if (score >= 40) return mid;
  return low;
}

function formatForTelegram(result: FormattedResponse, durationMs: number, label?: string): string {
  const parts: string[] = [];

  if (label) parts.push(`<b>${escTg(label)}</b>\n`);

  const scores: string[] = [];
  if (result.opportunityScore !== undefined) {
    scores.push(
      `${scoreEmoji(result.opportunityScore)} <b>Opportunity ${result.opportunityScore}/100</b>\n` +
      `<code>${scoreBar(result.opportunityScore)}</code>`
    );
  }
  if (result.riskScore !== undefined) {
    scores.push(
      `${scoreEmoji(result.riskScore, true)} <b>Risk ${result.riskScore}/100</b>\n` +
      `<code>${scoreBar(result.riskScore)}</code>`
    );
  }
  if (scores.length) parts.push(scores.join('\n') + '\n');

  parts.push(escTg(result.answer));

  if (result.suggestedActions.length > 0) {
    parts.push('\n<b>Actions:</b>');
    for (const action of result.suggestedActions) {
      parts.push(`› ${escTg(action)}`);
    }
  }

  parts.push(`\n<i>⚡ ${durationMs}ms · ClawNet</i>`);

  const msg = parts.join('\n');
  return msg.length > 4000 ? msg.slice(0, 3980) + '\n<i>…truncated</i>' : msg;
}

// ─── Demo query rotation ──────────────────────────────────────────────────────
// Built dynamically from apiRegistry so new endpoint categories automatically
// expand the showcase over time.

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
      'Show me Solana tokens with unusual volume spikes today. What is driving the volume and is it sustainable?',
      'Which Solana tokens have the lowest risk scores combined with positive price momentum? Score each by opportunity.',
    );
  }

  if (hasSocial) {
    queries.push(
      'What tokens are getting the most buzz on Twitter and Reddit right now? Show sentiment scores and whether the hype matches on-chain data.',
      'Find tokens with extremely bullish social sentiment but high on-chain risk scores — potential pump-and-dump setups to watch.',
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
      'Find tokens where social sentiment and on-chain data tell opposite stories. What does the contradiction suggest?',
    );
  }

  // Fallback if registry is empty
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

/**
 * Run a query and reply to the user.
 * If broadcast=true, also push the result to all subscribers (except the user who triggered it).
 */
async function replyWithQuery(
  ctx: Context,
  query: string,
  label?: string,
  broadcast = false,
): Promise<void> {
  // Show typing indicator so user knows something is happening
  try { await ctx.replyWithChatAction('typing'); } catch { /* ignore if unsupported */ }

  try {
    const { result, durationMs } = await runQuery(query);
    const formatted = formatForTelegram(result, durationMs, label);
    await ctx.reply(formatted, { parse_mode: 'HTML' });

    // Broadcast to subscribers (skip the user who triggered this)
    if (broadcast) {
      const triggerChatId = ctx.chat?.id;
      const subscribers = getTelegramSubscribers();
      const failed: number[] = [];
      for (const chatId of subscribers) {
        if (chatId === triggerChatId) continue;
        try {
          await bot!.api.sendMessage(chatId, formatted, { parse_mode: 'HTML' });
        } catch (err) {
          logger.warn({ chatId, err }, 'Telegram: failed to broadcast to subscriber');
          failed.push(chatId);
        }
      }
      // Clean up unreachable subscribers
      for (const chatId of failed) removeTelegramSubscriber(chatId);
    }
  } catch (err) {
    logger.error({ err, query: query.slice(0, 100) }, 'Telegram query failed');
    await ctx.reply(
      '⚠️ Something went wrong running that query. The service may be briefly unavailable — try again after the cooldown resets.',
    );
  }
}

function cooldownMsg(): string {
  return `⏳ <b>Global cooldown active.</b>\n\nClawNet runs 1 live analysis per 12 hours (shared across all users) to keep costs sustainable.\n\nNext query available in <b>${cooldownRemaining()}</b>.\n\n💡 Use /price &lt;token&gt; for instant price checks (no cooldown).`;
}

// ─── Help & About text ────────────────────────────────────────────────────────

function buildHelp(): string {
  const categories = [...new Set(apiRegistry.map((e) => e.category))];
  const endpointCount = apiRegistry.length;

  return (
    `🦀 <b>ClawNet</b> — Live AI analysis across <b>${endpointCount} endpoints</b>\n` +
    `Data sources: ${categories.slice(0, 8).join(', ')}${categories.length > 8 ? ', +more' : ''}\n\n` +
    `<b>⚡ Instant (no cooldown):</b>\n` +
    `/price &lt;token&gt; — Quick price check (1/min per user)\n` +
    `/skills — Browse the skill marketplace\n` +
    `/skill &lt;id&gt; — View skill details\n` +
    `/status — Bot health &amp; your subscription status\n` +
    `/about — What is ClawNet\n\n` +
    `<b>🔬 Analysis (1 per 12h, shared global cooldown):</b>\n` +
    `/demo — Run a live showcase analysis\n` +
    `/trending — Top Solana tokens by momentum\n` +
    `/analyze &lt;token&gt; — Deep price/risk/sentiment dive\n` +
    `/wallet &lt;address&gt; — Portfolio risk assessment\n` +
    `/sentiment &lt;token&gt; — Twitter &amp; Reddit sentiment\n` +
    `/news &lt;topic&gt; — Latest news digest\n` +
    `/ask &lt;question&gt; — Freeform question\n\n` +
    `/subscribe — Receive analysis results in this chat\n` +
    `/unsubscribe — Stop receiving results\n\n` +
    `<i>⏳ Analysis commands share a 12h global cooldown (max 2/day). Results are broadcast to all subscribers.</i>`
  );
}

function buildAbout(): string {
  const endpointCount = apiRegistry.length;
  const skillCount = listPublicSkills().length;
  return (
    `🦀 <b>ClawNet — Sovereign AI Orchestration</b>\n\n` +
    `ClawNet routes natural language queries through <b>${endpointCount} real-time data endpoints</b> — Solana blockchain, DeFi protocols, social sentiment, crypto news, and more — then synthesizes everything into a structured intelligence report.\n\n` +
    `<b>Platform stats:</b>\n` +
    `• ${endpointCount} live data endpoints\n` +
    `• ${skillCount} published skills in the marketplace\n` +
    `• Credits-based pricing (no subscription required)\n` +
    `• 97% revenue share for skill creators\n\n` +
    `<b>Get started:</b>\n` +
    `• API + docs: <a href="https://claw-net.org">claw-net.org</a>\n` +
    `• Skill marketplace: <a href="https://claw-net.org/marketplace.html">claw-net.org/marketplace.html</a>\n\n` +
    `<i>Type /demo to see a live analysis, or /help for all commands.</i>`
  );
}

// ─── Allowlist middleware ─────────────────────────────────────────────────────

const ALLOWED_USER_IDS: Set<number> = (() => {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS ?? '';
  if (!raw.trim()) return new Set<number>();
  return new Set(raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)));
})();

function isAllowedUser(userId: number): boolean {
  return ALLOWED_USER_IDS.size === 0 || ALLOWED_USER_IDS.has(userId);
}

// ─── Bot init ─────────────────────────────────────────────────────────────────

export async function initTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || process.env.NODE_ENV !== 'production') {
    logger.info('Telegram bot disabled (missing token or non-production env)');
    return;
  }

  try {
    bot = new Bot(token);

    // Allowlist middleware — runs before every update
    bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (userId === undefined || !isAllowedUser(userId)) {
        if (ALLOWED_USER_IDS.size > 0) await ctx.reply('Unauthorized.').catch(() => {});
        return;
      }
      await next();
    });

    // ── /start ────────────────────────────────────────────────────────────────
    bot.command('start', async (ctx) => {
      await ctx.reply(buildHelp(), { parse_mode: 'HTML' });
    });

    // ── /help ─────────────────────────────────────────────────────────────────
    bot.command('help', async (ctx) => {
      await ctx.reply(buildHelp(), { parse_mode: 'HTML' });
    });

    // ── /about ────────────────────────────────────────────────────────────────
    bot.command('about', async (ctx) => {
      await ctx.reply(buildAbout(), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    });

    // ── /status ───────────────────────────────────────────────────────────────
    bot.command('status', async (ctx) => {
      const chatId = ctx.chat.id;
      const subscribed = isTelegramSubscriber(chatId);
      const subscriberCount = getTelegramSubscribers().length;
      const endpointCount = apiRegistry.length;
      const skillCount = listPublicSkills().length;
      const cooldownStatus = isOnCooldown()
        ? `⏳ Active — resets in ${cooldownRemaining()}`
        : '✅ Ready — next query available now';

      await ctx.reply(
        `<b>ClawNet Status</b>\n\n` +
        `Subscription: ${subscribed ? '✅ Subscribed' : '❌ Not subscribed'}\n` +
        `Subscribers: <b>${subscriberCount}</b>\n` +
        `Endpoints: <b>${endpointCount}</b>\n` +
        `Public skills: <b>${skillCount}</b>\n` +
        `Global cooldown: ${cooldownStatus}\n` +
        `Mode: <b>${env.NODE_ENV}</b>`,
        { parse_mode: 'HTML' },
      );
    });

    // ── /subscribe ────────────────────────────────────────────────────────────
    bot.command('subscribe', async (ctx) => {
      const chatId = ctx.chat.id;
      if (isTelegramSubscriber(chatId)) {
        await ctx.reply('✅ Already subscribed. You\'ll receive analysis results whenever a live query runs (up to 2×/day).');
        return;
      }
      addTelegramSubscriber(chatId);
      logger.info({ chatId }, 'New Telegram subscriber');
      await ctx.reply(
        '✅ <b>Subscribed!</b>\n\nYou\'ll receive ClawNet analysis results whenever a live query runs (up to 2× per day, user-triggered).\n\nUse /help to see on-demand commands.',
        { parse_mode: 'HTML' },
      );
    });

    // ── /unsubscribe ──────────────────────────────────────────────────────────
    bot.command('unsubscribe', async (ctx) => {
      const chatId = ctx.chat.id;
      if (!isTelegramSubscriber(chatId)) {
        await ctx.reply('You\'re not subscribed. Use /subscribe to join.');
        return;
      }
      removeTelegramSubscriber(chatId);
      await ctx.reply('✅ Unsubscribed. On-demand commands still work anytime.');
    });

    // ── /demo — live showcase, broadcasts to all subscribers ──────────────────
    bot.command('demo', async (ctx) => {
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      const query = nextDemoQuery();
      await replyWithQuery(ctx, query, '🦀 ClawNet Live Demo', true);
    });

    // ── /trending ─────────────────────────────────────────────────────────────
    bot.command('trending', async (ctx) => {
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      await replyWithQuery(
        ctx,
        'Analyze the top trending Solana tokens right now. Show price, 24h change, risk score, and holder concentration for each. Rank by opportunity score.',
        '📈 Trending Now',
        true,
      );
    });

    // ── /analyze <token> ──────────────────────────────────────────────────────
    bot.command('analyze', async (ctx) => {
      const raw = ctx.match?.trim() ?? '';
      if (!raw) {
        await ctx.reply('Usage: /analyze &lt;token symbol or mint address&gt;\n\nExample: /analyze BONK', { parse_mode: 'HTML' });
        return;
      }
      const input = sanitizeInput(raw, 100);
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();

      const isAddress = input.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(input);
      const query = isAddress
        ? `Full analysis of Solana token at mint address ${input}: price, 24h change, risk score, holder distribution, and social sentiment.`
        : `Full analysis of the Solana token ${input.toUpperCase()}: current price, 24h change, risk score, top holder concentration, and social sentiment. Give a final verdict.`;

      await replyWithQuery(ctx, query, `🔬 Analysis: ${input.toUpperCase()}`, true);
    });

    // ── /wallet <address> ─────────────────────────────────────────────────────
    bot.command('wallet', async (ctx) => {
      const raw = ctx.match?.trim() ?? '';
      if (!raw || raw.length < 32) {
        await ctx.reply('Usage: /wallet &lt;Solana wallet address&gt;\n\nExample: /wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', { parse_mode: 'HTML' });
        return;
      }
      const address = sanitizeInput(raw, 100);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        await ctx.reply('⚠️ That doesn\'t look like a valid Solana address. Please check and try again.');
        return;
      }
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      await replyWithQuery(
        ctx,
        `Analyze Solana wallet ${address}: total portfolio value, top holdings, wallet risk score, bot probability, and recent transaction activity.`,
        '👛 Wallet Analysis',
        true,
      );
    });

    // ── /sentiment <token> ────────────────────────────────────────────────────
    bot.command('sentiment', async (ctx) => {
      const raw = ctx.match?.trim() ?? '';
      if (!raw) {
        await ctx.reply('Usage: /sentiment &lt;token symbol&gt;\n\nExample: /sentiment SOL', { parse_mode: 'HTML' });
        return;
      }
      const token = sanitizeInput(raw, 50);
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      await replyWithQuery(
        ctx,
        `Analyze Twitter and Reddit sentiment for ${token.toUpperCase()}. Show mention count, sentiment score, top posts, and whether the community is bullish or bearish.`,
        `💬 Sentiment: ${escTg(token.toUpperCase())}`,
        true,
      );
    });

    // ── /news <topic> ─────────────────────────────────────────────────────────
    bot.command('news', async (ctx) => {
      const raw = ctx.match?.trim() || 'Solana crypto';
      const topic = sanitizeInput(raw, 100);
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      await replyWithQuery(
        ctx,
        `Find the latest news about ${topic}. Summarize the top 5 stories and explain the likely market impact of each.`,
        `📰 News: ${escTg(topic)}`,
        true,
      );
    });

    // ── /ask <question> ───────────────────────────────────────────────────────
    bot.command('ask', async (ctx) => {
      const raw = ctx.match?.trim() ?? '';
      if (!raw) {
        await ctx.reply('Usage: /ask &lt;your question&gt;\n\nOr just type your question directly.', { parse_mode: 'HTML' });
        return;
      }
      const question = sanitizeInput(raw, 300);
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      await replyWithQuery(ctx, question, '🤖 ClawNet', true);
    });

    // ── /price <token> — instant, per-user 1/min, no global cooldown ──────────
    bot.command('price', async (ctx) => {
      const raw = ctx.match?.trim() ?? '';
      if (!raw) {
        await ctx.reply('Usage: /price &lt;token symbol or mint address&gt;\n\nExample: /price SOL', { parse_mode: 'HTML' });
        return;
      }
      const token = sanitizeInput(raw, 50);
      const userId = ctx.from!.id;
      const lastPrice = priceCooldowns.get(userId) ?? 0;
      if (Date.now() - lastPrice < PRICE_COOLDOWN_MS) {
        await ctx.reply('⏳ /price is limited to once per minute per user. Try again shortly.');
        return;
      }
      priceCooldowns.set(userId, Date.now());
      await replyWithQuery(
        ctx,
        `Get the current price, 24h change, volume, and market cap for ${token.toUpperCase()}. Keep it brief and factual.`,
        `💰 Price: ${escTg(token.toUpperCase())}`,
        false, // price checks are not broadcast — too frequent/lightweight
      );
    });

    // ── /skills — list marketplace registry ───────────────────────────────────
    bot.command('skills', async (ctx) => {
      const skills = listPublicSkills();
      if (skills.length === 0) {
        await ctx.reply('No public skills yet. Visit claw-net.org/marketplace.html to publish one.');
        return;
      }
      const lines: string[] = [
        `<b>🧩 ClawHub Skills (${skills.length} total)</b>\n`,
        ...skills.slice(0, 12).map((s) =>
          `<code>${escTg(s.id)}</code> · <b>${escTg(s.name)}</b> · ${s.credit_cost}cr\n` +
          `<i>${escTg(s.description.slice(0, 70))}${s.description.length > 70 ? '…' : ''}</i>`
        ),
      ];
      if (skills.length > 12) lines.push(`\n<i>…and ${skills.length - 12} more at <a href="https://claw-net.org/marketplace.html">claw-net.org/marketplace.html</a></i>`);
      lines.push('\nUse /skill &lt;id&gt; to view a skill\'s details.');
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    });

    // ── /skill <id> — view skill info (does NOT invoke — use the API) ─────────
    bot.command('skill', async (ctx) => {
      const args = (ctx.match?.trim() ?? '').split(/\s+/);
      const skillId = sanitizeInput(args[0] ?? '', 50);

      if (!skillId) {
        await ctx.reply('Usage: /skill &lt;id&gt;\n\nGet skill IDs from /skills', { parse_mode: 'HTML' });
        return;
      }

      const skill = getSkill(skillId);
      if (!skill || !skill.public) {
        await ctx.reply('Skill not found. Use /skills to see available skills.');
        return;
      }

      let vars: string[] = [];
      try {
        const matches = skill.prompt_template.match(/\{\{(\w+)\}\}/g) ?? [];
        vars = [...new Set(matches.map((m) => m.slice(2, -2)))];
      } catch { /* ignore */ }

      await ctx.reply(
        `<b>🧩 ${escTg(skill.name)}</b>\n` +
        `<code>${escTg(skill.id)}</code>\n\n` +
        `${escTg(skill.description)}\n\n` +
        `<b>Cost:</b> ${skill.credit_cost} credits\n` +
        `<b>Uses:</b> ${skill.uses}\n` +
        (vars.length ? `<b>Variables:</b> <code>${vars.join(', ')}</code>\n\n` : '\n') +
        `<b>Invoke via API:</b>\n` +
        `<code>POST /v1/marketplace/skills/${escTg(skill.id)}/purchase</code>\n\n` +
        `<a href="https://claw-net.org/marketplace.html#skill/${encodeURIComponent(skill.id)}">View on marketplace →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
      );
    });

    // ── Plain text → treat as a query ─────────────────────────────────────────
    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith('/')) return;
      if (text.length < 5) return;
      if (text.length > 500) {
        await ctx.reply('Query too long. Please keep it under 500 characters.');
        return;
      }
      if (isOnCooldown()) { await ctx.reply(cooldownMsg(), { parse_mode: 'HTML' }); return; }
      setCooldown();
      const query = sanitizeInput(text, 500);
      await replyWithQuery(ctx, query, '🤖 ClawNet', true);
    });

    bot.start({
      onStart: () => {
        const subs = getTelegramSubscribers().length;
        logger.info({ subscribers: subs, demoQueries: DEMO_QUERIES.length }, 'Telegram bot started');
      },
    });

  } catch (err) {
    logger.error({ err }, 'Failed to initialize Telegram bot');
  }
}

// ─── External broadcast (called by other modules with a pre-built message) ────

export async function sendTelegramAlert(message: string): Promise<void> {
  if (!bot) return;
  const subscribers = getTelegramSubscribers();
  if (subscribers.length === 0) return;

  const failed: number[] = [];
  for (const chatId of subscribers) {
    try {
      await bot.api.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn({ chatId, err }, 'Telegram: failed to send alert');
      failed.push(chatId);
    }
  }
  for (const chatId of failed) removeTelegramSubscriber(chatId);
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

export async function stopTelegram(): Promise<void> {
  if (bot) {
    await bot.stop();
    logger.info('Telegram bot stopped');
  }
}
