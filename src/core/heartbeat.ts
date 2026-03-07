import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { sendTelegramAlert } from '../integrations/telegram';

const DATA_DIR = path.join(process.cwd(), 'data');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.jsonl');
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;
let queryIndex = 0;

// Rotate through 4 different analysis types each hour
const QUERIES = [
  'Show me the top trending Solana tokens right now with price and volume data',
  'Analyze the top trending Solana tokens for rug risk, safety scores, and red flags',
  'What is the social sentiment and X/Twitter activity around the top trending Solana tokens?',
  'Give me a holder count and wallet distribution analysis for the top trending Solana tokens',
];

const QUERY_LABELS = ['📈 TRENDING', '🛡️ RISK SCAN', '💬 SENTIMENT', '👥 HOLDERS'];

// Use gpt-4o-mini to reformat the raw LLM paragraph into a tight bulletin
// This costs ~$0.0003 vs ~$0.018 for GPT-4o — 60x cheaper for simple reformatting
async function formatAsBulletin(rawAnswer: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return rawAnswer;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 350,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `You format crypto market analysis into concise Telegram bulletins.

Rules:
- 4-6 bullet points using • symbol
- Each bullet: [TOKEN SYMBOL] — specific finding with numbers
- End with one line: 💡 SIGNAL: [one sentence takeaway]
- No filler phrases ("it's important to note", "overall", "in conclusion")
- Be direct and specific — use real numbers, percentages, names
- Total output under 380 characters`,
          },
          {
            role: 'user',
            content: rawAnswer,
          },
        ],
      }),
    });

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const formatted = data.choices?.[0]?.message?.content?.trim();
    return formatted ?? rawAnswer;
  } catch (err) {
    logger.warn({ err }, 'Heartbeat: bulletin formatter failed, using raw answer');
    return rawAnswer;
  }
}

async function runHeartbeat() {
  const idx = queryIndex % QUERIES.length;
  const query = QUERIES[idx];
  const label = QUERY_LABELS[idx];
  queryIndex++;

  logger.info({ idx, label }, 'Heartbeat: running scheduled scan');

  try {
    const apiKey = process.env.API_KEYS?.split(',')[0] ?? '';
    const port = process.env.PORT ?? '3402';

    const response = await fetch(`http://localhost:${port}/v1/orchestrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json() as Record<string, unknown>;

    const meta = data.metadata as Record<string, unknown> | undefined;
    const cost = data.costBreakdown as Record<string, unknown> | undefined;
    const steps = (meta?.stepsExecuted as number) ?? 0;
    const cached = (meta?.cacheHits as number) ?? 0;
    const duration = (meta?.totalDurationMs as number) ?? 0;
    const totalCost = (cost?.total as number) ?? 0;

    const entry = {
      timestamp: new Date().toISOString(),
      success: response.ok,
      requestId: data.requestId,
      queryIndex: idx,
      label,
      steps,
      cost: totalCost,
      answer: typeof data.answer === 'string' ? data.answer.slice(0, 500) : null,
    };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(entry) + '\n');

    if (response.ok && typeof data.answer === 'string') {
      const bulletin = await formatAsBulletin(data.answer);

      // e.g. "Sat 07 Mar · 14:00 UTC"
      const now = new Date();
      const timeStr = now.toUTCString().replace(/:\d\d GMT$/, ' UTC');

      const message = [
        `🦀 <b>SOLANA MARKET PULSE</b>`,
        `${label} · ${timeStr}`,
        ``,
        bulletin,
        ``,
        `⚡ ${steps} steps · ${Math.round(duration / 1000)}s · $${totalCost.toFixed(4)} · ${cached} cached`,
        `📊 <a href="https://claw-net.org">claw-net.org</a>`,
      ].join('\n');

      await sendTelegramAlert(message);
      logger.info({ requestId: data.requestId, label }, 'Heartbeat: alert sent');
    } else {
      logger.warn({ code: data.code, label }, 'Heartbeat: orchestration failed, alert skipped');
    }
  } catch (err) {
    logger.error({ err, label }, 'Heartbeat: failed');
    const entry = { timestamp: new Date().toISOString(), success: false, label, error: String(err) };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(entry) + '\n');
  }
}

export function startHeartbeat() {
  // Calculate ms until the next hour boundary (:00)
  const now = new Date();
  const msUntilNextHour =
    (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

  setTimeout(() => {
    runHeartbeat();
    intervalId = setInterval(runHeartbeat, INTERVAL_MS);
  }, msUntilNextHour);

  const minutesUntil = Math.round(msUntilNextHour / 60000);
  logger.info(`Heartbeat scheduler started — first run in ${minutesUntil} min (next hour boundary)`);
}

export function stopHeartbeat() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Heartbeat scheduler stopped');
  }
}
