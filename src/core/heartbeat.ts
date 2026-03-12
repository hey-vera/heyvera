/**
 * Heartbeat — lightweight health pulse, no auto-queries.
 * Logs a health check entry every hour. Actual Telegram broadcasts
 * only happen when a real user triggers a command (user-driven model).
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const DATA_DIR = path.join(process.cwd(), 'data');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.jsonl');
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;
let startupTimerId: ReturnType<typeof setTimeout> | null = null;
const MAX_HEARTBEAT_LINES = 1000;

function rotateHeartbeatFile(): void {
  try {
    if (!fs.existsSync(HEARTBEAT_FILE)) return;
    const content = fs.readFileSync(HEARTBEAT_FILE, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length > MAX_HEARTBEAT_LINES) {
      fs.writeFileSync(HEARTBEAT_FILE, lines.slice(-MAX_HEARTBEAT_LINES).join('\n') + '\n');
    }
  } catch (err) {
    logger.warn({ err }, 'Heartbeat: file rotation failed');
  }
}

function runHeartbeat(): void {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'health',
    uptime: Math.floor(process.uptime()),
  };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(entry) + '\n');
    rotateHeartbeatFile();
    logger.debug({ uptime: entry.uptime }, 'Heartbeat: health pulse');
  } catch (err) {
    logger.warn({ err }, 'Heartbeat: failed to write pulse');
  }
}

export function startHeartbeat() {
  // Align to next hour boundary
  const now = new Date();
  const msUntilNextHour =
    (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

  startupTimerId = setTimeout(() => {
    startupTimerId = null;
    runHeartbeat();
    intervalId = setInterval(runHeartbeat, INTERVAL_MS);
  }, msUntilNextHour);

  const minutesUntil = Math.round(msUntilNextHour / 60000);
  logger.info(`Heartbeat scheduler started — first pulse in ${minutesUntil} min`);
}

export function stopHeartbeat() {
  if (startupTimerId) {
    clearTimeout(startupTimerId);
    startupTimerId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info('Heartbeat scheduler stopped');
}
