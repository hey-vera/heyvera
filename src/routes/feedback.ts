import { Hono } from 'hono';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export const feedbackRouter = new Hono();

const FeedbackSchema = z.object({
  requestId: z.string().min(1).max(50),
  rating: z.number().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

const DATA_DIR = path.join(process.cwd(), 'data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.jsonl');

feedbackRouter.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid feedback data', code: 'INVALID_FEEDBACK', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const entry = {
    ...parsed.data,
    timestamp: new Date().toISOString(),
    ip: c.req.header('x-forwarded-for') ?? 'unknown',
  };

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n');
    logger.info({ requestId: entry.requestId, rating: entry.rating }, 'Feedback received');
    return c.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    logger.error({ err }, 'Failed to save feedback');
    return c.json({ error: 'Failed to save feedback', code: 'STORAGE_ERROR' }, 500);
  }
});