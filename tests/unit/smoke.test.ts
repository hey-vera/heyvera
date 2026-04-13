/**
 * Smoke test — proves the vitest harness runs locally and in CI.
 *
 * This file exists only to anchor PR #1 of the rotation-on-main
 * migration. Real unit tests (vault-crypto, DB, rotation backend)
 * will arrive in subsequent PRs. Feel free to delete this file once
 * at least one real unit test is present.
 */
import { describe, expect, it } from 'vitest';

describe('vitest smoke', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
