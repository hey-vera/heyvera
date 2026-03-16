/**
 * Agent Event Webhooks — fire-and-forget delivery of economy events.
 *
 * Agents register webhook URLs via /v1/economy/webhooks, subscribing to events like:
 *   SKILL_INVOKED, CREDIT_LOW, BUDGET_DEPLETED, SLA_VIOLATED, PAYOUT_SENT, TRANSFER_RECEIVED
 *
 * Delivery: async, max 3 retries with exponential backoff.
 * HMAC signature: X-ClawNet-Signature header using agent's webhook_secret.
 */

import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { getDb } from '../db/index';
import { logger } from './logger';

export type WebhookEventType =
  | 'SKILL_INVOKED'
  | 'CREDIT_LOW'
  | 'BUDGET_DEPLETED'
  | 'SLA_VIOLATED'
  | 'PAYOUT_SENT'
  | 'TRANSFER_RECEIVED'
  | 'OUTPUT_CONTRACT_VIOLATION';

export interface WebhookRegistration {
  id: string;
  agent_key: string;
  url: string;
  events_json: string;
  secret: string | null;
  active: number;
  created_at: string;
  last_triggered_at: string | null;
  failure_count: number;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function createWebhook(params: {
  agentKey: string;
  url: string;
  events?: WebhookEventType[];
  secret?: string;
}): { ok: boolean; id?: string; error?: string } {
  const db = getDb();

  // Max 10 webhooks per agent
  const count = (db.prepare('SELECT COUNT(*) as n FROM agent_webhooks WHERE agent_key = ? AND active = 1').get(params.agentKey) as { n: number }).n;
  if (count >= 10) return { ok: false, error: 'Maximum 10 active webhooks per agent' };

  const id = nanoid(12);
  const events = params.events ?? ['*'];

  db.prepare(
    `INSERT INTO agent_webhooks (id, agent_key, url, events_json, secret)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, params.agentKey, params.url, JSON.stringify(events), params.secret ?? null);

  return { ok: true, id };
}

export function getWebhooks(agentKey: string): WebhookRegistration[] {
  return getDb()
    .prepare('SELECT * FROM agent_webhooks WHERE agent_key = ? AND active = 1 ORDER BY created_at DESC')
    .all(agentKey) as WebhookRegistration[];
}

export function deleteWebhook(agentKey: string, webhookId: string): boolean {
  const result = getDb()
    .prepare('UPDATE agent_webhooks SET active = 0 WHERE id = ? AND agent_key = ? AND active = 1')
    .run(webhookId, agentKey);
  return result.changes > 0;
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/**
 * Fire webhook for a specific event. Non-blocking — errors are logged, not thrown.
 * Looks up all active webhooks for the agent that subscribe to this event type.
 */
export function fireWebhookEvent(
  agentKey: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): void {
  const db = getDb();
  const hooks = db.prepare(
    `SELECT * FROM agent_webhooks WHERE agent_key = ? AND active = 1`
  ).all(agentKey) as WebhookRegistration[];

  for (const hook of hooks) {
    const events: string[] = JSON.parse(hook.events_json);
    if (!events.includes('*') && !events.includes(eventType)) continue;

    // Fire async — don't block the request
    deliverWebhook(hook, eventType, payload).catch(err => {
      logger.error({ err, webhookId: hook.id, eventType }, 'Webhook delivery failed');
    });
  }
}

const MAX_RETRIES = 3;

async function deliverWebhook(
  hook: WebhookRegistration,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ClawNet-Event': eventType,
  };

  // HMAC signature if secret is configured
  if (hook.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto.createHmac('sha256', hook.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    headers['X-ClawNet-Signature'] = `t=${timestamp},v1=${signature}`;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok || res.status < 500) {
        // Success or client error (don't retry 4xx)
        getDb().prepare(
          `UPDATE agent_webhooks SET last_triggered_at = datetime('now'), failure_count = 0 WHERE id = ?`
        ).run(hook.id);
        return;
      }

      lastError = new Error(`Webhook returned ${res.status}`);
    } catch (err) {
      lastError = err as Error;
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  // All retries exhausted
  const db = getDb();
  db.prepare(
    `UPDATE agent_webhooks SET failure_count = failure_count + 1 WHERE id = ?`
  ).run(hook.id);

  // Auto-disable after 10 consecutive failures
  const failCount = (db.prepare('SELECT failure_count FROM agent_webhooks WHERE id = ?').get(hook.id) as { failure_count: number })?.failure_count ?? 0;
  if (failCount >= 10) {
    db.prepare('UPDATE agent_webhooks SET active = 0 WHERE id = ?').run(hook.id);
    logger.warn({ webhookId: hook.id, agentKey: hook.agent_key }, 'Webhook auto-disabled after 10 failures');
  }

  logger.warn({ webhookId: hook.id, error: lastError?.message, attempts: MAX_RETRIES }, 'Webhook delivery exhausted retries');
}
