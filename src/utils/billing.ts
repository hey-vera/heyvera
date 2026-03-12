import { incrementDelegatedSpend } from '../db/index';

/**
 * After a successful deductCredit(), call this to track spending on delegated sub-keys.
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
    incrementDelegatedSpend(keyInfo.delegatedFrom, amount);
  }
}
