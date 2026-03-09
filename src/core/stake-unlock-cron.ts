import { getDb } from '../db/index';
import { logger } from '../utils/logger';

let timer: ReturnType<typeof setInterval> | null = null;

export function startStakeUnlockCron(): void {
  if (timer) return;
  runUnlockCheck();
  timer = setInterval(runUnlockCheck, 60_000); // Every minute
  logger.info('Stake auto-unlock cron started');
}

export function stopStakeUnlockCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function runUnlockCheck(): void {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const unlocked = db.transaction(() => {
      const expired = db.prepare(
        `SELECT id, agent_key, amount_credits FROM stakes WHERE unlocks_at <= ?`
      ).all(now) as { id: string; agent_key: string; amount_credits: number }[];

      for (const stake of expired) {
        db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ?`)
          .run(stake.amount_credits, stake.agent_key);
        db.prepare(`DELETE FROM stakes WHERE id = ?`).run(stake.id);
      }

      return expired.length;
    })();

    if (unlocked > 0) {
      logger.info({ unlocked }, 'Auto-unlocked expired stakes');
    }
  } catch (err) {
    logger.error({ err }, 'Stake unlock cron failed');
  }
}
