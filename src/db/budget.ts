import { getDb } from './connection';

/** Get hard budget lock for an API key */
export function getHardBudgetLock(apiKey: string): { enabled: boolean; limitCredits: number } | null {
  const row = getDb()
    .prepare('SELECT monthly_limit, enabled FROM budget_locks WHERE api_key = ?')
    .get(apiKey) as { monthly_limit: number; enabled: number } | undefined;
  if (!row) return null;
  return { enabled: row.enabled === 1, limitCredits: row.monthly_limit };
}

/** Set or update a hard budget lock */
export function setHardBudgetLock(apiKey: string, monthlyLimit: number): void {
  getDb()
    .prepare(
      `INSERT INTO budget_locks (api_key, monthly_limit, enabled)
       VALUES (?, ?, 1)
       ON CONFLICT(api_key) DO UPDATE SET monthly_limit = excluded.monthly_limit, enabled = 1`
    )
    .run(apiKey, monthlyLimit);
}

/** Remove (disable) a hard budget lock */
export function removeHardBudgetLock(apiKey: string): void {
  getDb().prepare('DELETE FROM budget_locks WHERE api_key = ?').run(apiKey);
}

/** Get total credits spent this calendar month for an API key */
export function getMonthlySpend(apiKey: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(total), 0) as spent
       FROM orchestrations
       WHERE api_key = ? AND timestamp >= strftime('%Y-%m-01', 'now')`
    )
    .get(apiKey) as { spent: number };
  return row.spent;
}
