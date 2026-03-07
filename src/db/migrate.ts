import fs from 'fs';
import path from 'path';
import { initDb, insertOrchestration, insertFeedback } from './index';
import { logger } from '../utils/logger';

const DATA_DIR = path.join(process.cwd(), 'data');

interface JsonlOrchestration {
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

interface JsonlFeedback {
  requestId: string;
  rating: number;
  comment?: string;
  timestamp: string;
  ip: string;
}

function migrateUsage(): number {
  const usageFile = path.join(DATA_DIR, 'usage.jsonl');
  if (!fs.existsSync(usageFile)) return 0;

  const lines = fs.readFileSync(usageFile, 'utf-8').split('\n').filter(Boolean);
  let count = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JsonlOrchestration;
      insertOrchestration({
        id: entry.requestId,
        timestamp: entry.timestamp,
        query: entry.query,
        plannedSteps: entry.plannedSteps ?? 0,
        executedSteps: entry.executedSteps ?? 0,
        successfulSteps: entry.successfulSteps ?? 0,
        cacheHits: entry.cacheHits ?? 0,
        totalDurationMs: entry.totalDurationMs ?? 0,
        apiCost: entry.apiCost ?? 0,
        markup: entry.markup ?? 0,
        total: entry.total ?? 0,
        success: entry.success ?? true,
        llmProvider: entry.llmProvider ?? 'unknown',
      });
      count++;
    } catch {
      // Skip malformed lines
    }
  }

  return count;
}

function migrateFeedback(): number {
  const feedbackFile = path.join(DATA_DIR, 'feedback.jsonl');
  if (!fs.existsSync(feedbackFile)) return 0;

  const lines = fs.readFileSync(feedbackFile, 'utf-8').split('\n').filter(Boolean);
  let count = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JsonlFeedback;
      insertFeedback({
        id: entry.requestId,
        requestId: entry.requestId,
        rating: entry.rating,
        comment: entry.comment,
        timestamp: entry.timestamp,
      });
      count++;
    } catch {
      // Skip malformed lines
    }
  }

  return count;
}

// Run migration
initDb();
const usageCount = migrateUsage();
const feedbackCount = migrateFeedback();
logger.info({ usageCount, feedbackCount }, 'Migration complete');