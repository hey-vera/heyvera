/**
 * agentkit-storage.ts — SQLite-backed AgentKitStorage for World AgentKit
 *
 * Implements the AgentKitStorage interface from @worldcoin/agentkit using
 * better-sqlite3 for production durability. Replaces InMemoryAgentKitStorage.
 *
 * Tables (migration v187):
 *   agentkit_usage  — per-human per-endpoint usage counts (atomic increment)
 *   agentkit_nonces — replay protection for CAIP-122 signed messages
 */

import { getDb } from './connection';

/**
 * AgentKitStorage interface — matches @worldcoin/agentkit's contract.
 * Defined inline to avoid import issues if the package types drift.
 */
export interface AgentKitStorage {
  tryIncrementUsage(endpoint: string, humanId: string, limit: number): Promise<boolean>;
  hasUsedNonce?(nonce: string): Promise<boolean>;
  recordNonce?(nonce: string): Promise<void>;
}

export class SqliteAgentKitStorage implements AgentKitStorage {
  /**
   * Atomic check-and-increment. Returns true if usage was under the limit
   * and was incremented, false if limit was already reached.
   */
  async tryIncrementUsage(endpoint: string, humanId: string, limit: number): Promise<boolean> {
    return getDb().transaction(() => {
      const row = getDb().prepare(
        'SELECT count FROM agentkit_usage WHERE endpoint = ? AND human_id = ?'
      ).get(endpoint, humanId) as { count: number } | undefined;

      if ((row?.count ?? 0) >= limit) return false;

      getDb().prepare(`
        INSERT INTO agentkit_usage (endpoint, human_id, count)
        VALUES (?, ?, 1)
        ON CONFLICT(endpoint, human_id) DO UPDATE SET count = count + 1
      `).run(endpoint, humanId);

      return true;
    })();
  }

  async hasUsedNonce(nonce: string): Promise<boolean> {
    const row = getDb().prepare(
      'SELECT 1 FROM agentkit_nonces WHERE nonce = ?'
    ).get(nonce);
    return !!row;
  }

  async recordNonce(nonce: string): Promise<void> {
    getDb().prepare(
      "INSERT OR IGNORE INTO agentkit_nonces (nonce) VALUES (?)"
    ).run(nonce);
  }
}

/** Singleton instance. */
let _storage: SqliteAgentKitStorage | null = null;
export function getAgentKitStorage(): SqliteAgentKitStorage {
  if (!_storage) _storage = new SqliteAgentKitStorage();
  return _storage;
}
