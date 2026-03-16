import { incrementDelegatedSpend, incrementBudgetSpend } from '../db/index';
import { logger } from './logger';
import { maskApiKey } from './mask';

/**
 * After a successful deductCredit(), call this to track spending on delegated sub-keys.
 * Also tracks daily/weekly budget spend for budget accounts.
 * No-op if the request isn't using a delegated key.
 *
 * Usage in routes:
 *   const deducted = deductCredit(keyInfo.key, amount);
 *   if (deducted) trackDelegatedSpend(keyInfo, amount);
 */
export function trackDelegatedSpend(
  keyInfo: { delegatedFrom?: string },
  amount: number,
): void {
  if (keyInfo.delegatedFrom && amount > 0) {
    const updated = incrementDelegatedSpend(keyInfo.delegatedFrom, amount);
    if (!updated) {
      logger.warn({ key: maskApiKey(keyInfo.delegatedFrom), amount }, 'incrementDelegatedSpend failed — spend limit may have been reached');
    }
    incrementBudgetSpend(keyInfo.delegatedFrom, amount);
  }
}
