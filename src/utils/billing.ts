import { incrementDelegatedSpend, incrementBudgetSpend, getDelegationChain } from '../db/index';
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
      logger.error({ key: maskApiKey(keyInfo.delegatedFrom), amount }, 'incrementDelegatedSpend failed — spend limit reached or DB error; credits already deducted');
    }
    incrementBudgetSpend(keyInfo.delegatedFrom, amount);
  }
}

/**
 * Soma Delegation Spec v0.1 §5 — build response headers exposing the authority
 * chain for a delegated call. Returns null when the caller isn't using a
 * delegated key. All key identifiers are masked (first 4 + last 4) per
 * least-privilege disclosure.
 *
 * Headers:
 *   X-Soma-Delegation-Chain  — comma-separated masked keys, leaf first
 *   X-Soma-Delegation-Depth  — leaf's depth in the chain (0 = first hop)
 *   X-Soma-Delegation-Hops   — number of delegation hops from root
 *   X-Soma-Delegation-Root   — masked root API key (parent of oldest delegation)
 *   X-Soma-Delegation-Intent — leaf's intent.declaration (if set)
 */
export function buildDelegationChainHeaders(
  delegatedFrom: string | undefined,
): Record<string, string> | null {
  if (!delegatedFrom) return null;
  const chain = getDelegationChain(delegatedFrom);
  if (chain.length === 0) return null;

  const leaf = chain[0];
  const rootAdjacent = chain[chain.length - 1];
  const headers: Record<string, string> = {
    'X-Soma-Delegation-Chain': chain.map((link) => maskApiKey(link.child_key)).join(','),
    'X-Soma-Delegation-Depth': String(leaf.depth),
    'X-Soma-Delegation-Hops': String(chain.length),
    'X-Soma-Delegation-Root': maskApiKey(rootAdjacent.parent_key),
  };
  if (leaf.intent_declaration) {
    // Sanitize: strip CRLF and non-ASCII to prevent header injection (audit M8)
    headers['X-Soma-Delegation-Intent'] = leaf.intent_declaration.replace(/[\r\n\x00-\x1f\x7f-\xff]/g, '');
  }
  return headers;
}
