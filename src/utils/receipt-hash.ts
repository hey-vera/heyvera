/**
 * Cryptographic receipt hashes — deterministic hashes for request/result verification.
 * Agents can verify that a transaction receipt matches the actual request/response data.
 * Uses SHA-256 via crypto-agility module for quantum resistance on trust primitives.
 */

import { aidHashPrefixed } from './crypto-agility';

/** Deterministic JSON serialization — sorted keys for consistent hashing. */
function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/** SHA-256 hash of skill invocation request parameters. */
export function computeRequestHash(params: {
  skillId: string;
  variables: Record<string, string>;
  timestamp: string;
}): string {
  const payload = canonicalize({
    skillId: params.skillId,
    variables: params.variables,
    timestamp: params.timestamp,
  });
  return aidHashPrefixed(payload);
}

/** SHA-256 hash of skill invocation result data. */
export function computeResultHash(params: {
  answer?: string;
  data?: unknown;
  costCredits: number;
}): string {
  const payload = canonicalize({
    answer: params.answer ?? null,
    data: params.data ?? null,
    costCredits: params.costCredits,
  });
  return aidHashPrefixed(payload);
}
