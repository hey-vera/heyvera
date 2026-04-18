/**
 * One-shot backfill: issue a Soma delegation leaf for every api_keys row
 * that has no matching row in soma_delegations.
 *
 * Run: npx tsx --env-file=.env scripts/backfill-soma-delegations.ts
 *
 * Skips accounts where clerk_user_id is NULL (no Clerk identity to delegate to).
 * Failures are logged and skipped — the script never aborts mid-run.
 */

import 'dotenv/config';
import { initDb, getDb } from '../src/db/index';
import { initSomaHeart, getHeart } from '../src/core/soma-heart';

type KeyRow = {
  key: string;
  clerk_user_id: string | null;
};

type DelegationRow = {
  id: string;
  api_key_id: string;
  clerk_user_id: string;
  subject_did: string;
  delegation_json: string;
};

async function main() {
  initDb();
  await initSomaHeart();

  const db = getDb();
  const heart = getHeart();

  // All active api_keys with no soma_delegations row.
  const pending = db.prepare<[], KeyRow>(`
    SELECT ak.key, ak.clerk_user_id
    FROM api_keys ak
    LEFT JOIN soma_delegations sd ON sd.api_key_id = ak.key
    WHERE ak.active = 1
      AND sd.id IS NULL
  `).all();

  console.log(`Backfill: ${pending.length} account(s) need a delegation leaf.`);

  if (pending.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  const insert = db.prepare<[string, string, string, string, string], void>(`
    INSERT OR IGNORE INTO soma_delegations (id, api_key_id, clerk_user_id, subject_did, delegation_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of pending) {
    if (!row.clerk_user_id) {
      console.log(`  SKIP  key=${row.key.slice(0, 11)}… (no clerk_user_id)`);
      skipped++;
      continue;
    }

    try {
      const subjectDid = `did:clawnet:${row.clerk_user_id}`;
      const delegation = heart.delegate({
        subjectDid,
        capabilities: ['clawnet:identity'],
      });
      insert.run(
        delegation.id,
        row.key,
        row.clerk_user_id,
        delegation.subjectDid,
        JSON.stringify(delegation),
      );
      console.log(`  OK    key=${row.key.slice(0, 11)}… delegationId=${delegation.id}`);
      succeeded++;
    } catch (err) {
      console.error(`  FAIL  key=${row.key.slice(0, 11)}… error=${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${succeeded} succeeded, ${skipped} skipped (no clerk_user_id), ${failed} failed.`);

  // Verification query.
  const { total, covered } = db.prepare<[], { total: number; covered: number }>(`
    SELECT
      (SELECT COUNT(*) FROM api_keys WHERE active = 1) AS total,
      (SELECT COUNT(DISTINCT sd.api_key_id)
       FROM soma_delegations sd
       INNER JOIN api_keys ak ON ak.key = sd.api_key_id AND ak.active = 1) AS covered
  `).get() as { total: number; covered: number };

  console.log(`\nVerification: ${covered}/${total} active api_keys rows now have a soma_delegations entry.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
