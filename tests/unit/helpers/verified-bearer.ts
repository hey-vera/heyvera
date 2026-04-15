/**
 * Test-only constructor for `VerifiedLegacyBearer`.
 *
 * Production code exports the brand type from `src/core/rotation-adoption.ts`
 * but does NOT export a constructor — Gate 7.2 has no production
 * verifier to ship. Tests that need to exercise the adoption primitive
 * construct the branded type here, under `tests/unit/helpers/`, so that
 * no production import path can reach the unsafe cast.
 *
 * This helper lives outside `src/` so the accidental-use grep guard in
 * `rotation-adoption.test.ts` does not need to special-case it. If a
 * future PR adds a real production verifier, it lives next to
 * `adoptPreVerifiedBearer` and this helper stays test-only.
 */

import type { VerifiedLegacyBearer } from '../../../src/core/rotation-adoption';

/**
 * Validate the `cn-[a-f0-9]{48}` format and return the string under the
 * `VerifiedLegacyBearer` brand. Throws on any other input. Tests use
 * this in place of a real legacy-path verifier.
 */
export function testVerifiedBearer(bearer: string): VerifiedLegacyBearer {
  if (!/^cn-[a-f0-9]{48}$/.test(bearer)) {
    throw new Error(
      `testVerifiedBearer: bearer does not match cn-[a-f0-9]{48}: ${bearer}`,
    );
  }
  return bearer as VerifiedLegacyBearer;
}

/**
 * Deterministic `cn-[a-f0-9]{48}` generator for test fixtures. Derives
 * 24 bytes from a SHA-256 of the input seed so each test can name its
 * own bearers without importing randomness.
 */
export function testBearerFromSeed(seed: string): VerifiedLegacyBearer {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 48);
  return testVerifiedBearer(`cn-${hex}`);
}
