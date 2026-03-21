/**
 * AID Trust Snapshot Cron
 *
 * Runs every 4 hours to build Merkle-tree trust snapshots for agents with
 * new cross-platform attestations. Signs snapshots with the platform key
 * and refreshes derived capabilities from attestation history.
 */

import cron from 'node-cron';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

interface AidIdentityRow {
  did: string;
  owner_key: string;
}

interface AttestationRow {
  id: string;
  did: string;
  platform: string;
  attestation_type: string;
  attestation_data: string;
  created_at: string;
}

let _running = false;
let task: ReturnType<typeof cron.schedule> | null = null;

async function runAidSnapshots(): Promise<void> {
  if (_running) return;
  _running = true;

  try {
    const db = getDb();

    // Find all agents with a non-null DID
    const agents = db.prepare(
      `SELECT ak.did, ak.owner_key
       FROM aid_keys ak
       WHERE ak.did IS NOT NULL
       ORDER BY ak.updated_at DESC
       LIMIT 500`
    ).all() as AidIdentityRow[];

    if (agents.length === 0) {
      logger.debug('AID snapshot cron: no agents with DIDs found');
      return;
    }

    let snapshotted = 0;
    let capabilitiesRefreshed = 0;

    // Lazy import — db/aid.ts and core/aid-builder.ts are created by other agents
    const aidDb = await import('../db/aid');
    const aidBuilder = await import('../core/aid-builder');

    for (const agent of agents) {
      try {
        // Get the latest snapshot timestamp for this DID
        const latestSnapshot = aidDb.getLatestSnapshot(agent.did);
        const lastSnapshotAt = latestSnapshot?.created_at || '1970-01-01T00:00:00Z';

        // Check for new attestations since last snapshot
        const newAttestations = db.prepare(
          `SELECT id, did, platform, attestation_type, attestation_data, created_at
           FROM aid_cross_platform_attestations
           WHERE did = ? AND created_at > ?
           ORDER BY created_at ASC
           LIMIT 500`
        ).all(agent.did, lastSnapshotAt) as AttestationRow[];

        if (newAttestations.length === 0) continue;

        // Get ALL attestations for full Merkle tree
        const allAttestations = aidDb.getCrossPlatformAttestations(agent.did, 1000);

        // Build trust snapshot (Merkle tree of all attestations)
        const snapshot = aidBuilder.buildTrustSnapshot(agent.did, allAttestations);

        // Store the snapshot
        aidDb.createTrustSnapshot(agent.did, snapshot);
        snapshotted++;

        // Refresh capabilities from attestation history
        const capabilities = aidBuilder.deriveCapabilities(allAttestations);
        for (const cap of capabilities) {
          aidDb.upsertCapability(agent.did, cap);
        }
        if (capabilities.length > 0) capabilitiesRefreshed++;

        logger.debug(
          { did: agent.did, attestations: newAttestations.length, capabilities: capabilities.length },
          'AID snapshot created'
        );
      } catch (err) {
        logger.error({ err, did: agent.did }, 'AID snapshot failed for agent');
      }
    }

    if (snapshotted > 0 || capabilitiesRefreshed > 0) {
      logger.info(
        { agents: agents.length, snapshotted, capabilitiesRefreshed },
        'AID snapshot cron complete'
      );
    } else {
      logger.debug({ agents: agents.length }, 'AID snapshot cron: no new attestations');
    }
  } catch (err) {
    logger.error({ err }, 'AID snapshot cron error');
  } finally {
    _running = false;
  }
}

export function startAidSnapshotCron(): void {
  // Run every 4 hours
  task = cron.schedule('0 */4 * * *', () => {
    runAidSnapshots().catch((err) => logger.error({ err }, 'AID snapshot cron unhandled error'));
  });

  // Also run once on startup (delayed 30s to let DB settle)
  setTimeout(() => {
    runAidSnapshots().catch((err) => logger.error({ err }, 'AID snapshot startup run failed'));
  }, 30_000);

  logger.info('AID snapshot cron started (every 4h)');
}

export function stopAidSnapshotCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
