import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { sendTelegramAlert } from '../integrations/telegram';

const DATA_DIR = path.join(process.cwd(), 'data');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.jsonl');
const INTERVAL_MS = 15 * 60 * 1000;

let intervalId: ReturnType<typeof setInterval> | null = null;

function formatTelegramMessage(data: Record<string, unknown>): string {
  const answer = typeof data.answer === 'string' ? data.answer : 'No analysis available';
  const meta = data.metadata as Record<string, unknown> | undefined;
  const cost = data.costBreakdown as Record<string, unknown> | undefined;
  const duration = meta?.totalDurationMs as number ?? 0;
  const steps = meta?.stepsExecuted as number ?? 0;
  const cached = meta?.cacheHits as number ?? 0;
  const totalCost = cost?.total as number ?? 0;

  // Truncate answer to fit Telegram's 4096 char limit
  const truncated = answer.length > 800 ? answer.slice(0, 800) + '...' : answer;

  const lines = [
    '🦀 <b>ClawNet — Solana Market Alert</b>',
    `🕐 ${new Date().toUTCString()}`,
    '',
    truncated,
    '',
    `⚡ ${steps} steps · ${Math.round(duration / 1000)}s · $${totalCost.toFixed(4)} · ${cached} cached`,
    '',
    '📊 <a href="https://claw-net.org">claw-net.org</a>',
  ];

  return lines.join('\n');
}

async function runHeartbeat() {
  logger.info('Heartbeat: running scheduled scan');

  try {
    const apiKey = process.env.API_KEYS?.split(',')[0] ?? '';

    const response = await fetch('http://localhost:' + (process.env.PORT ?? '3402') + '/v1/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        query: 'Show me the top trending Solana tokens right now with their metadata',
      }),
    });

    const data = await response.json() as Record<string, unknown>;

    const entry = {
      timestamp: new Date().toISOString(),
      success: response.ok,
      requestId: data.requestId,
      answer: typeof data.answer === 'string' ? data.answer.slice(0, 500) : null,
      stepsExecuted: (data.metadata as Record<string, unknown>)?.stepsExecuted ?? 0,
    };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(entry) + '\n');

    if (response.ok && typeof data.answer === 'string') {
      const message = formatTelegramMessage(data);
      await sendTelegramAlert(message);
      logger.info({ requestId: entry.requestId }, 'Heartbeat: completed and alert sent');
    } else {
      logger.warn({ requestId: entry.requestId, code: data.code }, 'Heartbeat: completed with errors, no alert sent');
    }

  } catch (err) {
    logger.error({ err }, 'Heartbeat: failed');
    const entry = { timestamp: new Date().toISOString(), success: false, error: String(err) };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(entry) + '\n');
  }
}

export function startHeartbeat() {
  setTimeout(() => {
    runHeartbeat();
    intervalId = setInterval(runHeartbeat, INTERVAL_MS);
  }, 60 * 1000);

  logger.info('Heartbeat scheduler started (every 15 minutes)');
}

export function stopHeartbeat() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Heartbeat scheduler stopped');
  }
}