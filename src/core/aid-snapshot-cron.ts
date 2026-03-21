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

let _running = false;
let task: ReturnType<typeof cron.schedule> | null = null;

async function runAidSnapshots(): Promise<void> {
  if (_running) return;
  _running = true;

  try {
    const db = getDb();

    // Find all agents with a non-null DID (via aid_keys, which has owner_key)
    const agents = db.prepare(
      `SELECT did, owner_key
       FROM aid_keys
       WHERE did IS NOT NULL AND key_status = 'active'
       ORDER BY created_at DESC
       LIMIT 500`
    ).all() as { did: string; owner_key: string }[];

    if (agents.length === 0) {
      logger.debug('AID snapshot cron: no agents with DIDs found');
      return;
    }

    let snapshotted = 0;
    let capabilitiesRefreshed = 0;

    // Lazy import
    const aidDb = await import('../db/aid');
    const aidBuilder = await import('../core/aid-builder');

    for (const agent of agents) {
      try {
        // Get the latest snapshot timestamp for this DID
        const latestSnapshot = aidDb.getLatestSnapshot(agent.did);
        const lastSnapshotAt = latestSnapshot?.created_at || '1970-01-01T00:00:00Z';

        // Check for new attestations since last snapshot
        const newCount = aidDb.countNewAttestationsSince(agent.did, lastSnapshotAt);
        if (newCount === 0) continue;

        // Build trust snapshot (queries attestations internally)
        const snapshotId = aidBuilder.buildTrustSnapshot(agent.did, agent.owner_key);
        if (snapshotId) {
          snapshotted++;

          // Prune old snapshots (keep last 50 per DID)
          aidDb.pruneSnapshots(agent.did, 50);
        }

        // Refresh capabilities from attestation history
        const capabilities = aidBuilder.deriveCapabilities(agent.owner_key);
        if (capabilities.length > 0) {
          aidDb.replaceCapabilities(agent.owner_key, capabilities);
          capabilitiesRefreshed++;
        }

        logger.debug(
          { did: agent.did, newAttestations: newCount, capabilities: capabilities.length },
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
