/**
 * agentkit-bridge.ts — AID-AgentKit bridge (Section 45.5)
 *
 * Optional World ID linking for maximum trust signal. Links AID identity
 * to Coinbase AgentKit wallet + optional World ID proof of humanity.
 *
 * "World proves WHO authorized it. AID proves WHETHER it's any good."
 *
 * Trust multiplier when World ID is linked:
 *   No World ID:         1.0x (standard AID scoring)
 *   World ID verified:   1.15x (proof of unique human principal)
 *   World ID + AgentKit: 1.2x (proof of human + wallet custody)
 */

import { getDb, logAudit } from '../db/connection';
import { aidHash } from './crypto-agility';
import { logger } from './logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentKitLink {
  did: string;
  agentKitWallet: string;
  worldIdHash: string | null;
  worldIdVerified: boolean;
  trustMultiplier: number;
  linkedAt: string;
}

export interface LinkResult {
  success: boolean;
  link?: AgentKitLink;
  error?: string;
}

// ─── Link Management ────────────────────────────────────────────────────────

/**
 * Link an AID identity to a Coinbase AgentKit wallet.
 *
 * @param did - Agent's AID DID
 * @param agentKitWallet - AgentKit wallet address (EVM)
 * @param worldIdProof - Optional World ID proof hash
 */
export function linkAgentKit(
  did: string,
  agentKitWallet: string,
  worldIdProof?: string,
): LinkResult {
  if (!did.startsWith('did:')) return { success: false, error: 'Invalid DID' };
  if (!agentKitWallet || agentKitWallet.length < 10) return { success: false, error: 'Invalid wallet address' };

  // Check DID exists
  const aidKey = getDb().prepare(
    `SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1`
  ).get(did) as { owner_key: string } | undefined;

  if (!aidKey) return { success: false, error: 'DID not found' };

  // Check for existing link
  const existing = getDb().prepare(
    `SELECT 1 FROM aid_agentkit_links WHERE did = ? LIMIT 1`
  ).get(did);
  if (existing) return { success: false, error: 'AgentKit already linked to this DID' };

  const worldIdHash = worldIdProof ? aidHash(worldIdProof) : null;
  const worldIdVerified = !!worldIdProof;

  // Compute trust multiplier
  let trustMultiplier = 1.0;
  if (worldIdVerified && agentKitWallet) trustMultiplier = 1.2;
  else if (worldIdVerified) trustMultiplier = 1.15;
  else if (agentKitWallet) trustMultiplier = 1.05;

  try {
    getDb().prepare(`
      INSERT INTO aid_agentkit_links (did, agentkit_wallet, world_id_hash,
                                     world_id_verified, trust_multiplier)
      VALUES (?, ?, ?, ?, ?)
    `).run(did, agentKitWallet, worldIdHash, worldIdVerified ? 1 : 0, trustMultiplier);

    logAudit({
      entityType: 'agentkit_link', entityId: did, action: 'linked',
      data: { wallet: agentKitWallet, worldId: worldIdVerified, multiplier: trustMultiplier },
    });

    const link: AgentKitLink = {
      did, agentKitWallet, worldIdHash, worldIdVerified, trustMultiplier,
      linkedAt: new Date().toISOString(),
    };

    return { success: true, link };
  } catch (err: any) {
    logger.error({ err }, 'AgentKit link failed');
    return { success: false, error: err.message };
  }
}

/**
 * Get AgentKit link for a DID (if any).
 */
export function getAgentKitLink(did: string): AgentKitLink | null {
  const row = getDb().prepare(
    `SELECT * FROM aid_agentkit_links WHERE did = ? LIMIT 1`
  ).get(did) as any;

  if (!row) return null;

  return {
    did: row.did,
    agentKitWallet: row.agentkit_wallet,
    worldIdHash: row.world_id_hash,
    worldIdVerified: !!row.world_id_verified,
    trustMultiplier: row.trust_multiplier,
    linkedAt: row.created_at,
  };
}

/**
 * Get the trust multiplier for a DID based on AgentKit/World ID link.
 */
export function getAgentKitMultiplier(did: string): number {
  const link = getAgentKitLink(did);
  return link?.trustMultiplier ?? 1.0;
}

/**
 * Unlink AgentKit from a DID.
 */
export function unlinkAgentKit(did: string): boolean {
  const result = getDb().prepare(`DELETE FROM aid_agentkit_links WHERE did = ?`).run(did);
  if (result.changes > 0) {
    logAudit({ entityType: 'agentkit_link', entityId: did, action: 'unlinked' });
  }
  return result.changes > 0;
}
