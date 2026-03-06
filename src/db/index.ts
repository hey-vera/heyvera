import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'orchestrator.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestrations (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      query TEXT NOT NULL,
      planned_steps INTEGER DEFAULT 0,
      executed_steps INTEGER DEFAULT 0,
      successful_steps INTEGER DEFAULT 0,
      cache_hits INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      api_cost REAL DEFAULT 0,
      markup REAL DEFAULT 0,
      total REAL DEFAULT 0,
      success INTEGER DEFAULT 1,
      llm_provider TEXT DEFAULT 'openai'
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      timestamp TEXT NOT NULL,
      ip TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orchestrations_timestamp ON orchestrations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_orchestrations_success ON orchestrations(success);
    CREATE INDEX IF NOT EXISTS idx_feedback_request_id ON feedback(request_id);
  `);

  logger.info({ path: DB_PATH }, 'SQLite database initialized');
}

export function insertOrchestration(entry: {
  id: string;
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
}): void {
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO orchestrations 
      (id, timestamp, query, planned_steps, executed_steps, successful_steps, 
       cache_hits, duration_ms, api_cost, markup, total, success, llm_provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.timestamp, entry.query.slice(0, 500),
      entry.plannedSteps, entry.executedSteps, entry.successfulSteps,
      entry.cacheHits, entry.totalDurationMs, entry.apiCost,
      entry.markup, entry.total, entry.success ? 1 : 0, entry.llmProvider
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to insert orchestration to SQLite');
  }
}

export function insertFeedback(entry: {
  requestId: string;
  rating: number;
  comment?: string;
  timestamp: string;
  ip: string;
}): void {
  try {
    getDb().prepare(`
      INSERT INTO feedback (request_id, rating, comment, timestamp, ip)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.requestId, entry.rating, entry.comment ?? null, entry.timestamp, entry.ip);
  } catch (err) {
    logger.warn({ err }, 'Failed to insert feedback to SQLite');
  }
}

export function getDbStats() {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as count FROM orchestrations').get() as { count: number }).count;
    const successful = (db.prepare('SELECT COUNT(*) as count FROM orchestrations WHERE success = 1').get() as { count: number }).count;
    const totalRevenue = (db.prepare('SELECT COALESCE(SUM(markup), 0) as revenue FROM orchestrations').get() as { revenue: number }).revenue;
    const avgDuration = (db.prepare('SELECT COALESCE(AVG(duration_ms), 0) as avg FROM orchestrations').get() as { avg: number }).avg;
    const feedbackCount = (db.prepare('SELECT COUNT(*) as count FROM feedback').get() as { count: number }).count;
    const avgRating = (db.prepare('SELECT COALESCE(AVG(rating), 0) as avg FROM feedback').get() as { avg: number }).avg;

    const topEndpoints = db.prepare(`
      SELECT query, COUNT(*) as count 
      FROM orchestrations 
      GROUP BY query 
      ORDER BY count DESC 
      LIMIT 5
    `).all() as { query: string; count: number }[];

    return {
      total,
      successful,
      errorRate: total > 0 ? Math.round(((total - successful) / total) * 100) : 0,
      totalRevenue: Math.round(totalRevenue * 10000) / 10000,
      avgDurationMs: Math.round(avgDuration),
      feedbackCount,
      avgRating: Math.round(avgRating * 10) / 10,
      topQueries: topEndpoints,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to get DB stats');
    return null;
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}