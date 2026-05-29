/**
 * Rotation adoption wrapper — policy boundary around the backend-level
 * storage primitive `ClawNetApiKeyBackend.adoptPreVerifiedBearer`.
 *
 * **Scope:** Gate 7.2 per ADR-0006. This module is a storage adoption
 * wrapper, not an authoritative rotation entry point:
 *
 *   - It does NOT call `CredentialRotationController.incept` and does
 *     NOT advance a rotation event chain (`pending → anchored →
 *     effective`). The adopted credential exists in the DB and is
 *     resolvable via `backend.lookupByBearer`, but nothing in the
 *     controller's in-memory state knows about it.
 *   - It does NOT make the rotation backend authoritative. The legacy
 *     auth path in `src/middleware/auth.ts` remains the only code that
 *     accepts or rejects a request.
 *   - It has NO production caller in Gate 7.2. The primitive is
 *     exercised by unit tests only. The real default-off kill-switch
 *     for rotation lookup lands in G7.3, before any auth wiring.
 *
 * **Trust boundary:** the wrapper refuses any ambient `string`. The
 * only accepted input is a `VerifiedLegacyBearer` — a branded type that
 * marks "the caller has already validated this bearer against the
 * legacy path". The brand is compile-time only (TypeScript erases it at
 * runtime), so the wrapper AND the backend primitive also re-check the
 * `cn-[a-f0-9]{48}` format at runtime as defense-in-depth.
 *
 * There is no `VerifiedLegacyBearer` constructor exported from this
 * module, by design:
 *
 *   - Gate 7.2 has no production verifier to ship. The legacy auth path
 *     is env-var-based (`env.API_KEYS`) and those bearers are
 *     explicitly skipped by the G7.3 shadow-check (ADR-0006 §7 P1.6).
 *     There is no real legacy store to verify against yet.
 *   - Tests that need to construct a `VerifiedLegacyBearer` import a
 *     test-local helper from `tests/unit/helpers/verified-bearer.ts`.
 *     That helper lives outside production code so a runtime
 *     NODE_ENV guard isn't needed — it cannot be reached from any
 *     production import path.
 *   - When a future PR adds a production caller (e.g. an admin mint
 *     route, or an `api_keys`-table lookup), that PR adds its own
 *     verifier alongside this file and updates the CI accidental-use
 *     guard in `tests/unit/rotation-adoption.test.ts`.
 *
 * **CI accidental-use guard:** `rotation-adoption.test.ts` greps every
 * file under `src/` (excluding this file and `api-key-rotation.ts`'s
 * primitive definition site) for `adoptPreVerifiedBearer` and
 * `VerifiedLegacyBearer`. Zero hits are required. This is an
 * *accidental*-use guard — it catches a forgetful PR author, not an
 * adversarial code path. A sufficiently obfuscated call site bypasses
 * it; the reviewer is the second gate.
 */

import type { Credential } from '../shims/soma-heart-credential-rotation';

import { ClawNetApiKeyBackend } from './api-key-rotation';
import { getDb } from '../db/index';

/**
 * Opaque brand marking a `cn-…` bearer that a trusted caller has
 * already validated against the legacy auth path. Runtime-erased; see
 * module header for the defense-in-depth regime.
 */
export type VerifiedLegacyBearer = string & {
  readonly __verifiedLegacyBearer: unique symbol;
};

export class AdoptionBearerFormatError extends Error {
  constructor(public readonly bearer: string) {
    super(
      `AdoptionBearerFormatError: bearer does not match cn-[a-f0-9]{48}: ${bearer}`,
    );
    this.name = 'AdoptionBearerFormatError';
  }
}

export interface AdoptionResult {
  credential: Credential;
  adoption: { bearer: string; identityId: string; adoptedAt: number };
  /** True when the bearer was already adopted and the call was a no-op read. */
  idempotent: boolean;
}

export interface AdoptPreVerifiedBearerArgs {
  bearer: VerifiedLegacyBearer;
  identityId: string;
  issuedAt: number;
  ttlMs: number;
  /** Inject a backend for tests. Defaults to one bound to the process DB. */
  backend?: ClawNetApiKeyBackend;
}

const BEARER_REGEX = /^cn-[a-f0-9]{48}$/;

/**
 * Adopt a pre-verified legacy bearer as a rotation credential.
 *
 * All writes happen in a single sync `db.transaction(...)` inside
 * `ClawNetApiKeyBackend.adoptPreVerifiedBearer`. On any throw the
 * transaction rolls back and no partial rows remain.
 *
 * Idempotent: re-calling with the same bearer returns the original
 * adoption row without minting a second credential.
 */
export function adoptPreVerifiedBearer(
  args: AdoptPreVerifiedBearerArgs,
): AdoptionResult {
  // Runtime re-validation of the brand. TypeScript's compile-time
  // guarantee is gone at runtime; this line is the actual defense.
  if (!BEARER_REGEX.test(args.bearer)) {
    throw new AdoptionBearerFormatError(args.bearer);
  }

  const backend = args.backend ?? new ClawNetApiKeyBackend({ db: getDb() });
  return backend.adoptPreVerifiedBearer({
    bearer: args.bearer,
    identityId: args.identityId,
    issuedAt: args.issuedAt,
    ttlMs: args.ttlMs,
  });
}
