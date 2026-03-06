import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export interface UsageEntry {
  requestId: string;
  timestamp: string;
  query: string;
  plannedSteps: number;
  executedSteps: number;
  successfulSteps: number;
  cacheHits: number;
  totalDurationMs: number;
  apiCost: number;
  markup: number;
  total: number;
  success: boolean;
  llmProvider: string;
}

const ring: UsageEntry[] = [];
const RING_SIZE = 1000;
const DATA_DIR = path.join(process.cwd(), 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.jsonl');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function logUsage(entry: UsageEntry): void {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();

  try {
    ensureDataDir();
    fs.appendFileSync(USAGE_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.warn({ err }, 'Failed to write usage log');
  }
}

export function getRecentUsage(limit = 50): UsageEntry[] {
  return ring.slice(-limit).reverse();
}

export function getUsageStats() {
  if (ring.length === 0) return { total: 0, avgDurationMs: 0, cacheHitRate: 0, totalRevenue: 0 };
  const total = ring.length;
  const avgDurationMs = Math.round(ring.reduce((s, e) => s + e.totalDurationMs, 0) / total);
  const totalCacheHits = ring.reduce((s, e) => s + e.cacheHits, 0);
  const totalSteps = ring.reduce((s, e) => s + e.executedSteps, 0);
  const cacheHitRate = totalSteps > 0 ? Math.round((totalCacheHits / totalSteps) * 100) : 0;
  const totalRevenue = ring.reduce((s, e) => s + e.markup, 0);
  return { total, avgDurationMs, cacheHitRate, totalRevenue: Math.round(totalRevenue * 10000) / 10000 };
}