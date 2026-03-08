import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { insertFeedback } from '../db/index';
import { logger } from '../utils/logger';

export const feedbackRouter = new Hono();

const FeedbackSchema = z.object({
  requestId: z.string().min(1).max(50),
  rating: z.number().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

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
    id: nanoid(12),
    requestId: parsed.data.requestId,
    rating: parsed.data.rating,
    comment: parsed.data.comment,
    timestamp: new Date().toISOString(),
  };

  insertFeedback(entry);
  logger.info({ requestId: entry.requestId, rating: entry.rating }, 'Feedback received');
  return c.json({ success: true, message: 'Thank you for your feedback!' });
});
