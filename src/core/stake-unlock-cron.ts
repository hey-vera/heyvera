import { getDb } from '../db/index';
import { logger } from '../utils/logger';

let timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

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
  if (_running) return;
  _running = true;
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const unlocked = db.transaction(() => {
      const expired = db.prepare(
        `SELECT id, agent_key, amount_credits FROM stakes WHERE unlocks_at <= ?`
      ).all(now) as { id: string; agent_key: string; amount_credits: number }[];

      let count = 0;
      for (const stake of expired) {
        const restored = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ?`)
          .run(stake.amount_credits, stake.agent_key);
        if (restored.changes === 0) {
          // Key missing — preserve the stake row so an admin can recover the credits manually
          logger.error({ stakeId: stake.id, agentKey: stake.agent_key.slice(0, 8), amount: stake.amount_credits },
            'CRITICAL: stake expired but API key not found — credits not restored, stake preserved for manual recovery');
          continue;
        }
        db.prepare(`DELETE FROM stakes WHERE id = ?`).run(stake.id);
        count++;
      }
      return count;
    })();

    if (unlocked > 0) {
      logger.info({ unlocked }, 'Auto-unlocked expired stakes');
    }
  } catch (err) {
    logger.error({ err }, 'Stake unlock cron failed');
  } finally {
    _running = false;
  }
}
