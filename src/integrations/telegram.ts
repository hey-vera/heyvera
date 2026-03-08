import { Bot } from 'grammy';
import { logger } from '../utils/logger';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse, FormattedResponse } from '../core/formatter';
import { apiRegistry } from '../config/api-registry';
import { listPublicSkills, getSkill, incrementSkillUses } from '../db/index';
import { env } from '../config/index';
import fs from 'fs';
import path from 'path';

// ─── Subscriber persistence ───────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), 'data');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');

let bot: Bot | null = null;
let subscribers: Set<number> = new Set();

function loadSubscribers() {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8')) as number[];
      subscribers = new Set(data);
      logger.info({ count: subscribers.size }, 'Telegram subscribers loaded');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load subscribers');
  }
}

function saveSubscribers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify([...subscribers]));
  } catch (err) {
    logger.warn({ err }, 'Failed to save subscribers');
  }
}

// ─── Feed query rotation ──────────────────────────────────────────────────────
// Auto-adapts: queries are built from apiRegistry categories so adding new
// endpoints automatically expands the feed's coverage over time.

function buildFeedRotation(): string[] {
  const categories = [...new Set(apiRegistry.map((e) => e.category))];
  const hasSolana = categories.includes('solana');
  const hasSocial = categories.includes('social');
  const hasUtility = categories.includes('utility');

  const queries: string[] = [];

  if (hasSolana) {
    queries.push(
      'Analyze the top 3 trending Solana tokens right now. For each: current price, 24h change, risk score, and a one-line verdict. Which has the best risk/reward?',
      'Which trending Solana tokens have the highest rug pull risk right now? Show risk scores and specific red flags for each.',
      'Show me the Solana tokens with unusual volume spikes today. What is driving the volume and is it sustainable?',
      'Which trending tokens have the lowest risk scores combined with positive price momentum? Score each by opportunity.',
    );
  }

  if (hasSocial) {
    queries.push(
      'What tokens are getting the most buzz on Twitter and Reddit right now? Show sentiment scores and whether the hype matches the on-chain data.',
      'Find tokens with extremely bullish social sentiment but high risk scores — potential pump-and-dump setups to watch.',
      'Which crypto projects have the most authentic organic engagement on X/Twitter right now versus bot-driven hype?',
    );
  }

  if (hasUtility) {
    queries.push(
      'What are the top 5 Solana and crypto news stories right now? For each, give a one-line summary and its likely market impact.',
      'Search for news about Solana ecosystem developments this week. What should traders be paying attention to?',
    );
  }

  if (hasSolana && hasSocial) {
    queries.push(
      'Cross-reference the top trending Solana tokens with their social sentiment and risk scores. Which has the strongest overall signal?',
      'Find tokens where social sentiment and on-chain data tell opposite stories. What does the contradiction suggest?',
    );
  }

  if (hasSolana && hasUtility) {
    queries.push(
      'Combine the latest crypto news with trending token data. Are any tokens directly affected by breaking news right now?',
    );
  }

  return queries;
}

const FEED_ROTATION = buildFeedRotation();
let feedIndex = 0;

function nextFeedQuery(): string {
  const q = FEED_ROTATION[feedIndex % FEED_ROTATION.length];
  feedIndex++;
  return q;
}

// ─── Rate limiting + cost budget ─────────────────────────────────────────────
// Each user gets 1 on-demand query per 12 hours. Anyone can query — no subscription required.
// Feed runs are separate (scheduled, not counted here).

const userCooldowns = new Map<number, number>();
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours per user

function isOnCooldown(chatId: number): boolean {
  const last = userCooldowns.get(chatId) ?? 0;
  return Date.now() - last < COOLDOWN_MS;
}

function cooldownRemaining(chatId: number): string {
  const last = userCooldowns.get(chatId) ?? 0;
  const remainMs = COOLDOWN_MS - (Date.now() - last);
  const h = Math.floor(remainMs / 3_600_000);
  const m = Math.floor((remainMs % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function setCooldown(chatId: number): void {
  userCooldowns.set(chatId, Date.now());
}

// ─── Telegram HTML formatter ──────────────────────────────────────────────────

function scoreBar(score: number, outOf = 100): string {
  const filled = Math.round((score / outOf) * 8);
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

function formatForTelegram(
  result: FormattedResponse,
  durationMs: number,
  label?: string,
): string {
  const parts: string[] = [];

  if (label) parts.push(`<b>${escTg(label)}</b>\n`);

  // Scores
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

  // Main answer — preserve line breaks, escape HTML
  parts.push(escTg(result.answer));

  // Suggested actions
  if (result.suggestedActions.length > 0) {
    parts.push('\n<b>Actions:</b>');
    for (const action of result.suggestedActions) {
      parts.push(`› ${escTg(action)}`);
    }
  }

  parts.push(`\n<i>⚡ ${durationMs}ms · ClawNet</i>`);

  const msg = parts.join('\n');
  // Telegram message limit is 4096 chars
  return msg.length > 4000 ? msg.slice(0, 3980) + '\n<i>…truncated</i>' : msg;
}

function escTg(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Core orchestration helper ────────────────────────────────────────────────

async function runQuery(query: string): Promise<{ result: FormattedResponse; durationMs: number }> {
  const start = Date.now();
  const intent = await parseIntent(query);
  const execution = await executePlan(intent);
  const result = await formatResponse(query, intent, execution);
  return { result, durationMs: Date.now() - start };
}

async function replyWithQuery(
  ctx: { reply: (text: string, opts?: { parse_mode?: string }) => Promise<unknown> },
  query: string,
  label?: string,
): Promise<void> {
  try {
    const { result, durationMs } = await runQuery(query);
    await ctx.reply(formatForTelegram(result, durationMs, label), { parse_mode: 'HTML' });
  } catch (err) {
    logger.error({ err, query }, 'Telegram query failed');
    await ctx.reply('⚠️ Something went wrong running that query. Try again in a moment.');
  }
}

// ─── Help text ────────────────────────────────────────────────────────────────

function buildHelp(): string {
  const categories = [...new Set(apiRegistry.map((e) => e.category))];
  const endpointCount = apiRegistry.length;

  return (
    `🦀 <b>ClawNet Bot</b>\n\n` +
    `I run live AI queries across <b>${endpointCount} endpoints</b> covering: ${categories.join(', ')}.\n\n` +
    `<b>Commands:</b>\n` +
    `/analyze &lt;token&gt; — Deep dive on a token (price, risk, sentiment)\n` +
    `/trending — What's hot on Solana right now\n` +
    `/wallet &lt;address&gt; — Portfolio + risk score for a wallet\n` +
    `/news &lt;topic&gt; — Latest news on any topic\n` +
    `/sentiment &lt;token&gt; — Twitter + Reddit sentiment analysis\n` +
    `/skills — Browse the ClawHub skill registry\n` +
    `/skill &lt;id&gt; — Invoke a ClawHub skill\n` +
    `/ask &lt;question&gt; — Ask anything\n` +
    `/subscribe — Join the automated feed (every 15 min)\n` +
    `/unsubscribe — Leave the feed\n` +
    `/status — Your subscription status\n\n` +
    `<i>Or just type any question — I'll figure it out.</i>`
  );
}

// ─── Bot init ─────────────────────────────────────────────────────────────────

export async function initTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || process.env.NODE_ENV !== 'production') {
    logger.info('Telegram bot disabled in development mode');
    return;
  }

  try {
    loadSubscribers();
    bot = new Bot(token);

    // /start
    bot.command('start', async (ctx) => {
      await ctx.reply(buildHelp(), { parse_mode: 'HTML' });
    });

    // /help
    bot.command('help', async (ctx) => {
      await ctx.reply(buildHelp(), { parse_mode: 'HTML' });
    });

    // /subscribe
    bot.command('subscribe', async (ctx) => {
      const chatId = ctx.chat.id;
      if (subscribers.has(chatId)) {
        await ctx.reply('✅ Already subscribed. Feed runs every 15 minutes.');
        return;
      }
      subscribers.add(chatId);
      saveSubscribers();
      logger.info({ chatId }, 'New Telegram subscriber');
      await ctx.reply(
        '✅ <b>Subscribed!</b>\n\nYou\'ll receive live Solana intelligence every 15 minutes.\n\nUse /help to see on-demand commands.',
        { parse_mode: 'HTML' }
      );
    });

    // /unsubscribe
    bot.command('unsubscribe', async (ctx) => {
      const chatId = ctx.chat.id;
      if (!subscribers.has(chatId)) {
        await ctx.reply('You\'re not subscribed. Use /subscribe to join the feed.');
        return;
      }
      subscribers.delete(chatId);
      saveSubscribers();
      await ctx.reply('✅ Unsubscribed from the feed. On-demand commands still work.');
    });

    // /status
    bot.command('status', async (ctx) => {
      const chatId = ctx.chat.id;
      const isSubscribed = subscribers.has(chatId);
      const endpointCount = apiRegistry.length;
      const skillCount = listPublicSkills().length;
      await ctx.reply(
        `<b>ClawNet Status</b>\n\n` +
        `Feed: ${isSubscribed ? '✅ Subscribed' : '❌ Not subscribed'}\n` +
        `Endpoints online: <b>${endpointCount}</b>\n` +
        `Public skills: <b>${skillCount}</b>\n` +
        `Mode: <b>${env.NODE_ENV}</b>`,
        { parse_mode: 'HTML' }
      );
    });

    // /trending
    bot.command('trending', async (ctx) => {
      const chatId = ctx.chat.id;
      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);
      await replyWithQuery(
        ctx,
        'Analyze the top trending Solana tokens right now. Show price, 24h change, risk score, and holder concentration for each. Rank them by opportunity.',
        '📈 Trending Now'
      );
    });

    // /analyze <token>
    bot.command('analyze', async (ctx) => {
      const chatId = ctx.chat.id;
      const input = ctx.match?.trim();
      if (!input) {
        await ctx.reply('Usage: /analyze &lt;token symbol or mint address&gt;\n\nExample: /analyze BONK', { parse_mode: 'HTML' });
        return;
      }
      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);

      const isAddress = input.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(input);
      const query = isAddress
        ? `Full analysis of Solana token at mint address ${input}: price, 24h change, risk score, holder distribution, and social sentiment.`
        : `Full analysis of the Solana token ${input.toUpperCase()}: current price, 24h change, risk score, top holder concentration, and Twitter/Reddit sentiment. Give a final verdict.`;

      await replyWithQuery(ctx, query, `🔬 Analysis: ${input.toUpperCase()}`);
    });

    // /wallet <address>
    bot.command('wallet', async (ctx) => {
      const chatId = ctx.chat.id;
      const address = ctx.match?.trim();
      if (!address || address.length < 32) {
        await ctx.reply('Usage: /wallet &lt;Solana wallet address&gt;', { parse_mode: 'HTML' });
        return;
      }
      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);
      await replyWithQuery(
        ctx,
        `Analyze Solana wallet ${address}: total portfolio value, top holdings, wallet risk score, bot probability, and recent transaction activity.`,
        `👛 Wallet Analysis`
      );
    });

    // /news <topic>
    bot.command('news', async (ctx) => {
      const chatId = ctx.chat.id;
      const topic = ctx.match?.trim() || 'Solana crypto';
      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);
      await replyWithQuery(
        ctx,
        `Find the latest news about ${topic}. Summarize the top 5 stories and explain the likely market impact of each.`,
        `📰 News: ${topic}`
      );
    });

    // /sentiment <token>
    bot.command('sentiment', async (ctx) => {
      const chatId = ctx.chat.id;
      const token = ctx.match?.trim();
      if (!token) {
        await ctx.reply('Usage: /sentiment &lt;token symbol&gt;\n\nExample: /sentiment SOL', { parse_mode: 'HTML' });
        return;
      }
      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);
      await replyWithQuery(
        ctx,
        `Analyze Twitter and Reddit sentiment for ${token.toUpperCase()}. Show mention count, sentiment score, top posts, and whether the community is bullish or bearish.`,
        `💬 Sentiment: ${token.toUpperCase()}`
      );
    });

    // /skills — list ClawHub registry
    bot.command('skills', async (ctx) => {
      const skills = listPublicSkills();
      if (skills.length === 0) {
        await ctx.reply('No public skills yet. Be the first — see claw-net.org to publish one.');
        return;
      }
      const lines = [
        `<b>🧩 ClawHub Skills (${skills.length})</b>\n`,
        ...skills.slice(0, 15).map((s) =>
          `<code>${s.id}</code> · <b>${s.name}</b>\n${escTg(s.description.slice(0, 80))}${s.description.length > 80 ? '…' : ''}\n<i>${s.uses} uses</i>`
        ),
      ];
      if (skills.length > 15) lines.push(`\n<i>…and ${skills.length - 15} more at claw-net.org</i>`);
      lines.push('\nUse /skill &lt;id&gt; to invoke a skill.');
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    });

    // /skill <id> [key=value ...]
    bot.command('skill', async (ctx) => {
      const chatId = ctx.chat.id;
      const args = ctx.match?.trim().split(/\s+/) ?? [];
      const skillId = args[0];

      if (!skillId) {
        await ctx.reply('Usage: /skill &lt;id&gt; [key=value ...]\n\nGet skill IDs from /skills', { parse_mode: 'HTML' });
        return;
      }

      const skill = getSkill(skillId);
      if (!skill || !skill.public) {
        await ctx.reply('Skill not found. Use /skills to see available skills.');
        return;
      }

      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);

      // Parse key=value pairs from remaining args
      const variables: Record<string, string> = {};
      for (const arg of args.slice(1)) {
        const [k, ...v] = arg.split('=');
        if (k && v.length) variables[k] = v.join('=');
      }

      // Render template
      let query = skill.prompt_template;
      try {
        query = skill.prompt_template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
          if (!(key in variables)) throw new Error(`Missing variable: ${key}`);
          return variables[key];
        });
      } catch (err) {
        const missing = (skill.prompt_template.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2));
        await ctx.reply(
          `⚠️ This skill needs variables: <code>${missing.join(', ')}</code>\n\n` +
          `Usage: /skill ${skillId} ${missing.map((k) => `${k}=value`).join(' ')}`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      await replyWithQuery(ctx, query, `🧩 ${skill.name}`);
      incrementSkillUses(skillId);
    });

    // /ask <question>
    bot.command('ask', async (ctx) => {
      const chatId = ctx.chat.id;
      const question = ctx.match?.trim();
      if (!question) {
        await ctx.reply('Usage: /ask &lt;your question&gt;\n\nOr just type your question directly.', { parse_mode: 'HTML' });
        return;
      }
      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);
      await replyWithQuery(ctx, question);
    });

    // Plain text → treat as a query
    bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat.id;
      const text = ctx.message.text.trim();

      // Ignore commands (already handled above)
      if (text.startsWith('/')) return;
      if (text.length < 5) return;
      if (text.length > 1000) {
        await ctx.reply('Query too long. Keep it under 1000 characters.');
        return;
      }

      if (isOnCooldown(chatId)) { await ctx.reply(`⏳ You can ask 1 query every 12 hours. Next query available in ${cooldownRemaining(chatId)}.`); return; }
      setCooldown(chatId);
      await replyWithQuery(ctx, text);
    });

    bot.start({
      onStart: () => logger.info({ subscribers: subscribers.size }, 'Telegram bot started'),
    });

  } catch (err) {
    logger.error({ err }, 'Failed to initialize Telegram bot');
  }
}

// ─── Automated feed broadcast ─────────────────────────────────────────────────

export async function sendTelegramAlert(message?: string): Promise<void> {
  if (!bot || subscribers.size === 0) return;

  let text: string;

  if (message) {
    // External override (e.g. from heartbeat with a pre-built message)
    text = message;
  } else {
    // Auto-generate from feed rotation
    const query = nextFeedQuery();
    try {
      const { result, durationMs } = await runQuery(query);
      text = formatForTelegram(result, durationMs, '🦀 ClawNet Feed');
    } catch (err) {
      logger.error({ err }, 'Feed query failed — skipping broadcast');
      return;
    }
  }

  const failed: number[] = [];
  for (const chatId of subscribers) {
    try {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn({ chatId, err }, 'Failed to send Telegram message');
      failed.push(chatId);
    }
  }

  if (failed.length > 0) {
    for (const chatId of failed) subscribers.delete(chatId);
    saveSubscribers();
  }
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

export async function stopTelegram(): Promise<void> {
  if (bot) {
    await bot.stop();
    logger.info('Telegram bot stopped');
  }
}
