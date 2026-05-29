import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const DATA_DIR = path.join(process.cwd(), 'data');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.jsonl');
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;

async function runHeartbeat() {
  logger.info('Heartbeat: running scheduled scan');
  
  try {
    const response = await fetch('http://localhost:' + (process.env.PORT ?? '3402') + '/v1/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Check trending Solana tokens and flag any with high rug risk' }),
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
    
    logger.info({ requestId: entry.requestId }, 'Heartbeat: completed');
  } catch (err) {
    logger.error({ err }, 'Heartbeat: failed');
    const entry = { timestamp: new Date().toISOString(), success: false, error: String(err) };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(entry) + '\n');
  }
}

export function startHeartbeat() {
  // Run first heartbeat after 1 minute, then every 15 minutes
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