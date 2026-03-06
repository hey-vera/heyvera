import { Bot } from 'grammy';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

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

export async function initTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.info('Telegram bot not configured (no TELEGRAM_BOT_TOKEN)');
    return;
  }

  try {
    loadSubscribers();
    bot = new Bot(token);

    bot.command('start', async (ctx) => {
      await ctx.reply(
        '🦀 Welcome to ClawNet Alerts!\n\n' +
        'I send automated Solana token analysis every 15 minutes.\n\n' +
        'Commands:\n' +
        '/subscribe — Start receiving alerts\n' +
        '/unsubscribe — Stop receiving alerts\n' +
        '/status — Check your subscription status'
      );
    });

    bot.command('subscribe', async (ctx) => {
      const chatId = ctx.chat.id;
      if (subscribers.has(chatId)) {
        await ctx.reply('✅ You are already subscribed to ClawNet alerts!');
        return;
      }
      subscribers.add(chatId);
      saveSubscribers();
      logger.info({ chatId }, 'New Telegram subscriber');
      await ctx.reply(
        '✅ Subscribed! You will receive Solana token analysis alerts every 15 minutes.\n\n' +
        'Use /unsubscribe to stop at any time.'
      );
    });

    bot.command('unsubscribe', async (ctx) => {
      const chatId = ctx.chat.id;
      if (!subscribers.has(chatId)) {
        await ctx.reply('You are not currently subscribed.');
        return;
      }
      subscribers.delete(chatId);
      saveSubscribers();
      await ctx.reply('✅ Unsubscribed. You will no longer receive alerts.');
    });

    bot.command('status', async (ctx) => {
      const chatId = ctx.chat.id;
      const isSubscribed = subscribers.has(chatId);
      await ctx.reply(
        isSubscribed
          ? '✅ You are subscribed to ClawNet alerts.'
          : '❌ You are not subscribed. Use /subscribe to start.'
      );
    });

    // Start polling
    bot.start({
      onStart: () => logger.info({ subscribers: subscribers.size }, 'Telegram bot started'),
    });

  } catch (err) {
    logger.error({ err }, 'Failed to initialize Telegram bot');
  }
}

export async function sendTelegramAlert(message: string): Promise<void> {
  if (!bot || subscribers.size === 0) return;

  const failed: number[] = [];
  for (const chatId of subscribers) {
    try {
      await bot.api.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn({ chatId, err }, 'Failed to send Telegram message');
      failed.push(chatId);
    }
  }

  // Remove subscribers that have blocked the bot
  for (const chatId of failed) {
    subscribers.delete(chatId);
  }
  if (failed.length > 0) saveSubscribers();
}

export async function stopTelegram(): Promise<void> {
  if (bot) {
    await bot.stop();
    logger.info('Telegram bot stopped');
  }
}