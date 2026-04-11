/**
 * Shadow-adoption Phase 1 glue for the Soma CredentialRotationController.
 *
 * This module is the seam where ClawNet's live `cn-...` API keys meet the
 * rotation primitive shipped in `soma-heart@0.2.0`. It does three things:
 *
 *   1. Owns the process-wide singleton `CredentialRotationController` and
 *      `ClawNetApiKeyBackend` instances (lazy — so tests and unused
 *      commands don't pay the startup cost).
 *   2. Exposes `adoptApiKey()` which takes an existing `cn-...` string,
 *      creates a Soma identity for it, and incepts a rotation credential
 *      whose bearer is the same `cn-...` string. The customer never sees
 *      a change to their token.
 *   3. Exposes `shadowCheckApiKey()` which `checkApiKey` middleware calls
 *      alongside the legacy path. In Phase 1 the return value is purely
 *      observational — logged and counted for agreement/divergence, but
 *      legacy still wins every decision.
 *
 * Phase 2 will flip `authoritative = 1` on adopted rows and let the
 * rotation backend become primary for those keys; Phase 3 deletes the
 * legacy static path. See credential-rotation-architecture.md §9a.
 *
 * Anchor/witness: skipped in Phase 1. The rotation primitive's
 * `lookupByBearer` reads the credential row directly without consulting
 * the controller's effective-state machine, so a credential row exists
 * and resolves even without being "current" in the controller. When
 * Phase 2 lands we'll wire a real anchor/witness flow.
 */

import crypto from 'node:crypto';

import {
  CredentialRotationController,
  DEFAULT_POLICY,
} from 'soma-heart/credential-rotation';

import { getDb, logAudit } from '../db/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { ClawNetApiKeyBackend } from './api-key-rotation';

// ─── Singletons ─────────────────────────────────────────────────────────────

let backendSingleton: ClawNetApiKeyBackend | null = null;
let controllerSingleton: CredentialRotationController | null = null;

export function getRotationBackend(): ClawNetApiKeyBackend {
  if (!backendSingleton) {
    backendSingleton = new ClawNetApiKeyBackend({ db: getDb() });
  }
  return backendSingleton;
}

export function getRotationController(): CredentialRotationController {
  if (!controllerSingleton) {
    const backend = getRotationBackend();
    controllerSingleton = new CredentialRotationController({
      policy: {
        ...DEFAULT_POLICY,
        backendAllowlist: [backend.backendId],
      },
      clock: () => Date.now(),
    });
    controllerSingleton.registerBackend(backend);
  }
  return controllerSingleton;
}

/** Test-only — clears the lazy singletons so a fresh in-memory DB can be used. */
export function _resetRotationStackForTests(): void {
  backendSingleton = null;
  controllerSingleton = null;
}

// ─── Adoption ───────────────────────────────────────────────────────────────

export interface AdoptionRecord {
  apiKey: string;
  identityId: string;
  adoptedAt: number;
  authoritative: boolean;
}

/**
 * Derive a deterministic Soma identity id from an existing cn-... key.
 * Deterministic so re-running adoption on the same key is a no-op rather
 * than creating duplicate identities. `id-cn-` prefix keeps adoption
 * identities visually distinct from freshly-inceptioned ones in logs.
 */
function identityIdForApiKey(apiKey: string): string {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  return `id-cn-${hash.slice(0, 32)}`;
}

export function getAdoption(apiKey: string): AdoptionRecord | null {
  const row = getDb()
    .prepare(
      'SELECT api_key, identity_id, adopted_at, authoritative FROM api_key_rotation_adoptions WHERE api_key = ?',
    )
    .get(apiKey) as
    | {
        api_key: string;
        identity_id: string;
        adopted_at: number;
        authoritative: number;
      }
    | undefined;
  if (!row) return null;
  return {
    apiKey: row.api_key,
    identityId: row.identity_id,
    adoptedAt: row.adopted_at,
    authoritative: row.authoritative === 1,
  };
}

/**
 * Adopt an existing `cn-...` api key into the rotation stack.
 *
 * Creates a fresh Soma identity whose first credential has the existing
 * key as its bearer. Idempotent — re-adopting the same key returns the
 * existing record. Does NOT touch the legacy `api_keys` row; the caller
 * is expected to have already verified that the key exists there.
 */
export async function adoptApiKey(apiKey: string): Promise<AdoptionRecord> {
  if (!/^cn-[a-f0-9]{48}$/.test(apiKey)) {
    throw new Error(`adoptApiKey: malformed api key ${apiKey.slice(0, 8)}…`);
  }

  const existing = getAdoption(apiKey);
  if (existing) return existing;

  const identityId = identityIdForApiKey(apiKey);
  const backend = getRotationBackend();
  const controller = getRotationController();

  backend.adoptExistingBearer(apiKey);
  await controller.incept({ identityId, backendId: backend.backendId });

  const adoptedAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO api_key_rotation_adoptions
         (api_key, identity_id, adopted_at, authoritative)
       VALUES (?, ?, ?, 0)`,
    )
    .run(apiKey, identityId, adoptedAt);

  logAudit({
    entityType: 'api_key_rotation',
    entityId: apiKey,
    action: 'shadow_adopt',
    data: { identityId, phase: 1 },
  });

  logger.info(
    { key: maskApiKey(apiKey), identityId },
    'Shadow-adopted api key into rotation stack',
  );

  return {
    apiKey,
    identityId,
    adoptedAt,
    authoritative: false,
  };
}

// ─── Shadow check (read-only, observational) ───────────────────────────────

export type ShadowCheckResult =
  | { outcome: 'not_adopted' }
  | { outcome: 'agree'; identityId: string }
  | {
      outcome: 'disagree_missing';
      reason: string;
    }
  | {
      outcome: 'disagree_mismatch';
      identityId: string;
      reason: string;
    };

/**
 * In-memory shadow-check counters. Exposed so the admin dashboard or a
 * cron can snapshot them; not persisted anywhere. Reset on process
 * restart, which is fine for Phase 1 observation.
 */
export const shadowCheckCounters = {
  notAdopted: 0,
  agree: 0,
  disagreeMissing: 0,
  disagreeMismatch: 0,
};

/**
 * Called by checkApiKey middleware AFTER the legacy path has already
 * resolved a key. Returns an observation-only verdict; the middleware
 * does not act on it beyond logging and counter bumps. Legacy always
 * wins in Phase 1.
 */
export function shadowCheckApiKey(
  apiKey: string,
  now: number,
): ShadowCheckResult {
  const adoption = getAdoption(apiKey);
  if (!adoption) {
    shadowCheckCounters.notAdopted += 1;
    return { outcome: 'not_adopted' };
  }

  const backend = getRotationBackend();
  const rotationView = backend.lookupByBearer(apiKey, now);

  if (!rotationView) {
    shadowCheckCounters.disagreeMissing += 1;
    logger.warn(
      { key: maskApiKey(apiKey), identityId: adoption.identityId },
      'Shadow rotation lookup failed for adopted key',
    );
    return {
      outcome: 'disagree_missing',
      reason: 'rotation backend has no live credential for adopted bearer',
    };
  }

  if (rotationView.identityId !== adoption.identityId) {
    shadowCheckCounters.disagreeMismatch += 1;
    logger.warn(
      {
        key: maskApiKey(apiKey),
        expected: adoption.identityId,
        actual: rotationView.identityId,
      },
      'Shadow rotation identity mismatch',
    );
    return {
      outcome: 'disagree_mismatch',
      identityId: rotationView.identityId,
      reason: `rotation identityId ${rotationView.identityId} does not match adoption record ${adoption.identityId}`,
    };
  }

  shadowCheckCounters.agree += 1;
  return { outcome: 'agree', identityId: rotationView.identityId };
}
