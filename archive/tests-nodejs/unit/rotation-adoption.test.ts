/**
 * Unit tests — Gate 7.2 rotation adoption wrapper and backend primitive.
 *
 * Covers the whole adoption surface:
 *
 *   - brand-type refusal at the wrapper entry
 *   - happy path: adopted credential row, identity row, adoption row
 *   - `backend.lookupByBearer` resolves the adopted bearer
 *   - idempotency: re-call returns the same row with `idempotent: true`
 *   - collision: pre-existing credential row without an adoption row
 *     is refused
 *   - transaction atomicity: synthetic throw inside the wrapped
 *     transaction rolls all three tables back
 *   - AAD binding: adopted credential ciphertext cannot be pasted into
 *     a non-adopted row
 *   - no-regression on the existing controller-driven path
 *   - accidental-use CI guard: no src file imports the adoption primitive
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  CredentialRotationController,
  DEFAULT_POLICY,
} from 'soma-heart/credential-rotation';

import { _resetDbForTests, closeDb, initDb } from '../../src/db/index';
import {
  AdoptionBearerCollisionError,
  ClawNetApiKeyBackend,
} from '../../src/core/api-key-rotation';
import {
  AdoptionBearerFormatError,
  adoptPreVerifiedBearer,
  type VerifiedLegacyBearer,
} from '../../src/core/rotation-adoption';
import {
  testBearerFromSeed,
  testVerifiedBearer,
} from './helpers/verified-bearer';

function makeStack(clockMs = 1_700_000_000_000) {
  const db = initDb({ path: ':memory:' });
  const clock = { t: clockMs };
  const backend = new ClawNetApiKeyBackend({ db });
  const controller = new CredentialRotationController({
    policy: {
      ...DEFAULT_POLICY,
      backendAllowlist: [backend.backendId],
      maxRotationsPerHour: 1000,
      rotationBurst: 100,
    },
    clock: () => clock.t,
  });
  controller.registerBackend(backend);
  return { backend, controller, clock, db };
}

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  closeDb();
});

describe('rotation-adoption wrapper — brand boundary', () => {
  it('testVerifiedBearer throws on a badly formatted string', () => {
    expect(() => testVerifiedBearer('not-a-bearer')).toThrow(
      /cn-\[a-f0-9\]\{48\}/,
    );
    expect(() => testVerifiedBearer('cn-SHORT')).toThrow();
    // Uppercase hex must be refused — ClawNet bearers are all lowercase.
    expect(() => testVerifiedBearer('cn-' + 'A'.repeat(48))).toThrow();
  });

  it('adoptPreVerifiedBearer wrapper rejects a downcast string with wrong format', () => {
    const { backend } = makeStack();
    // Simulate a caller that bypassed the brand at compile time.
    const bad = 'cn-only-12-chars' as unknown as VerifiedLegacyBearer;
    expect(() =>
      adoptPreVerifiedBearer({
        bearer: bad,
        identityId: 'id-bad',
        issuedAt: 1,
        ttlMs: 600_000,
        backend,
      }),
    ).toThrow(AdoptionBearerFormatError);
  });
});

describe('rotation-adoption wrapper — happy path', () => {
  it('writes credential, identity, and adoption rows atomically', () => {
    const { backend, db } = makeStack();
    const bearer = testBearerFromSeed('happy-path-id-1');
    const result = adoptPreVerifiedBearer({
      bearer,
      identityId: 'id-1',
      issuedAt: 1_700_000_000_000,
      ttlMs: 600_000,
      backend,
    });

    expect(result.idempotent).toBe(false);
    expect(result.credential.credentialId).toBe(bearer);
    expect(result.credential.identityId).toBe('id-1');
    expect(result.credential.class).toBe('A');
    expect(result.credential.algorithmSuite).toBe('ed25519');
    expect(result.adoption).toEqual({
      bearer,
      identityId: 'id-1',
      adoptedAt: 1_700_000_000_000,
    });

    // All three rows landed.
    const credRow = db
      .prepare(
        'SELECT credential_id, identity_id, revoked FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(bearer) as
      | { credential_id: string; identity_id: string; revoked: number }
      | undefined;
    expect(credRow?.credential_id).toBe(bearer);
    expect(credRow?.identity_id).toBe('id-1');
    expect(credRow?.revoked).toBe(0);

    const identRow = db
      .prepare(
        'SELECT identity_id, current_credential_id FROM api_key_rotation_identities WHERE identity_id = ?',
      )
      .get('id-1') as
      | { identity_id: string; current_credential_id: string }
      | undefined;
    expect(identRow?.current_credential_id).toBe(bearer);

    const adoptRow = db
      .prepare(
        'SELECT bearer, identity_id, adopted_at FROM api_key_rotation_adoption WHERE bearer = ?',
      )
      .get(bearer) as
      | { bearer: string; identity_id: string; adopted_at: number }
      | undefined;
    expect(adoptRow).toEqual({
      bearer,
      identity_id: 'id-1',
      adopted_at: 1_700_000_000_000,
    });
  });

  it('lookupByBearer resolves the adopted bearer to its identity', () => {
    const { backend } = makeStack();
    const bearer = testBearerFromSeed('lookup-id');
    adoptPreVerifiedBearer({
      bearer,
      identityId: 'id-lookup',
      issuedAt: 1_700_000_000_000,
      ttlMs: 600_000,
      backend,
    });

    const lookup = backend.lookupByBearer(bearer, 1_700_000_000_000 + 1);
    expect(lookup?.identityId).toBe('id-lookup');
    expect(lookup?.expiresAt).toBe(1_700_000_000_000 + 600_000);

    // Past expiry returns null.
    const expired = backend.lookupByBearer(
      bearer,
      1_700_000_000_000 + 600_000 + 1,
    );
    expect(expired).toBeNull();
  });

  it('signWithCredential works on the adopted credential', async () => {
    const { backend } = makeStack();
    const bearer = testBearerFromSeed('sign-id');
    adoptPreVerifiedBearer({
      bearer,
      identityId: 'id-sign',
      issuedAt: 1_700_000_000_000,
      ttlMs: 600_000,
      backend,
    });

    const msg = new TextEncoder().encode('adoption-sign');
    const sig = await backend.signWithCredential(bearer, msg);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(await backend.verifyWithCredential(bearer, msg, sig)).toBe(true);
  });
});

describe('rotation-adoption wrapper — idempotency', () => {
  it('re-calling with the same bearer returns the existing row', () => {
    const { backend, db } = makeStack();
    const bearer = testBearerFromSeed('idempotent-id');
    const first = adoptPreVerifiedBearer({
      bearer,
      identityId: 'id-idem',
      issuedAt: 1_700_000_000_000,
      ttlMs: 600_000,
      backend,
    });
    expect(first.idempotent).toBe(false);

    const second = adoptPreVerifiedBearer({
      bearer,
      identityId: 'id-idem',
      issuedAt: 1_700_000_999_999, // different timestamp
      ttlMs: 600_000,
      backend,
    });
    expect(second.idempotent).toBe(true);
    // Adoption row is unchanged — first adoption's adopted_at wins.
    expect(second.adoption.adoptedAt).toBe(1_700_000_000_000);
    expect(second.credential.credentialId).toBe(bearer);

    // Exactly one credential row and one adoption row.
    const credCount = (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM api_key_rotation_credentials WHERE credential_id = ?',
        )
        .get(bearer) as { n: number }
    ).n;
    expect(credCount).toBe(1);
    const adoptCount = (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM api_key_rotation_adoption WHERE bearer = ?',
        )
        .get(bearer) as { n: number }
    ).n;
    expect(adoptCount).toBe(1);
  });
});

describe('rotation-adoption wrapper — collision refusal', () => {
  it('refuses to adopt a bearer that already exists as a non-adopted credential', () => {
    const { backend, controller, db } = makeStack();
    // Create a non-adopted rotation credential via the regular mint
    // path, then discover its credential_id and try to adopt it.
    // Controller-driven mint is the normal entry.
    return (async () => {
      const { event, credential } = await controller.incept({
        identityId: 'id-stray',
        backendId: backend.backendId,
      });
      controller.anchorEvent('id-stray', event.hash, `root-${event.hash}`);
      controller.witnessEvent('id-stray', event.hash);

      const strayBearer = testVerifiedBearer(credential.credentialId);

      expect(() =>
        adoptPreVerifiedBearer({
          bearer: strayBearer,
          identityId: 'id-stray-claim',
          issuedAt: 1_700_000_000_000,
          ttlMs: 600_000,
          backend,
        }),
      ).toThrow(AdoptionBearerCollisionError);

      // No adoption row written for the stray bearer.
      const row = db
        .prepare(
          'SELECT bearer FROM api_key_rotation_adoption WHERE bearer = ?',
        )
        .get(credential.credentialId);
      expect(row).toBeUndefined();
    })();
  });
});

describe('rotation-adoption wrapper — transaction atomicity', () => {
  it('a throw during the transaction rolls all three tables back', () => {
    const { backend, db } = makeStack();
    const bearer = testBearerFromSeed('atomic-id');

    // Monkey-patch db.prepare to throw on the adoption INSERT only.
    const realPrepare = db.prepare.bind(db);
    let sabotaged = false;
    (db as unknown as { prepare: typeof db.prepare }).prepare = ((
      sql: string,
    ) => {
      const stmt = realPrepare(sql);
      if (
        !sabotaged &&
        /INSERT INTO api_key_rotation_adoption/i.test(sql)
      ) {
        sabotaged = true;
        return {
          ...stmt,
          run: () => {
            throw new Error('synthetic-failure: adoption INSERT');
          },
        } as unknown as typeof stmt;
      }
      return stmt;
    }) as typeof db.prepare;

    expect(() =>
      adoptPreVerifiedBearer({
        bearer,
        identityId: 'id-atomic',
        issuedAt: 1_700_000_000_000,
        ttlMs: 600_000,
        backend,
      }),
    ).toThrow(/synthetic-failure/);

    // Restore db.prepare.
    (db as unknown as { prepare: typeof db.prepare }).prepare = realPrepare;

    // All three tables are empty for this identity/bearer — the
    // rollback covered the credential and identity INSERTs that
    // preceded the failing adoption INSERT.
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM api_key_rotation_credentials WHERE credential_id = ?',
        )
        .get(bearer),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM api_key_rotation_identities WHERE identity_id = ?',
        )
        .get('id-atomic'),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM api_key_rotation_adoption WHERE bearer = ?',
        )
        .get(bearer),
    ).toEqual({ n: 0 });
  });
});

describe('rotation-adoption wrapper — AAD binding', () => {
  it('pasting an adopted credential ciphertext into a non-adopted row fails verify', async () => {
    const { backend, controller, db } = makeStack();

    // Adopted credential A.
    const adoptedBearer = testBearerFromSeed('aad-adopted');
    adoptPreVerifiedBearer({
      bearer: adoptedBearer,
      identityId: 'id-aad-a',
      issuedAt: 1_700_000_000_000,
      ttlMs: 600_000,
      backend,
    });

    // Non-adopted credential B via the normal controller-driven mint.
    const b = await controller.incept({
      identityId: 'id-aad-b',
      backendId: backend.backendId,
    });
    controller.anchorEvent('id-aad-b', b.event.hash, `root-${b.event.hash}`);
    controller.witnessEvent('id-aad-b', b.event.hash);

    // Paste A's secret_key ciphertext into B's row.
    const rowA = db
      .prepare(
        'SELECT secret_key FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(adoptedBearer) as { secret_key: string };
    db.prepare(
      'UPDATE api_key_rotation_credentials SET secret_key = ? WHERE credential_id = ?',
    ).run(rowA.secret_key, b.credential.credentialId);

    // B's sign path now throws — AEAD auth tag is bound to A's
    // credential_id, not B's.
    await expect(
      backend.signWithCredential(
        b.credential.credentialId,
        new TextEncoder().encode('x'),
      ),
    ).rejects.toThrow();
  });
});

describe('rotation-adoption — no regression on controller path', () => {
  it('controller-driven incept + rotate still works alongside adoption', async () => {
    const { backend, controller } = makeStack();

    // Adopt one bearer (storage-only path).
    adoptPreVerifiedBearer({
      bearer: testBearerFromSeed('coexist-adopted'),
      identityId: 'id-coexist-a',
      issuedAt: 1_700_000_000_000,
      ttlMs: 600_000,
      backend,
    });

    // Drive the regular controller path on a different identity.
    const first = await controller.incept({
      identityId: 'id-coexist-b',
      backendId: backend.backendId,
    });
    controller.anchorEvent(
      'id-coexist-b',
      first.event.hash,
      `root-${first.event.hash}`,
    );
    controller.witnessEvent('id-coexist-b', first.event.hash);

    const msg = new TextEncoder().encode('coexist');
    const sig = await controller.sign('id-coexist-b', msg);
    expect(await controller.verify('id-coexist-b', msg, sig)).toBe(true);
  });
});

describe('rotation-adoption — accidental-use guard', () => {
  /**
   * This is an accidental-use guard, not a security boundary. Greps
   * every file under `src/` for symbols that would indicate a
   * production caller of the Gate 7.2 adoption primitive. Only
   * `src/core/rotation-adoption.ts` and `src/core/api-key-rotation.ts`
   * (which defines the primitive) are allowed to mention them.
   *
   * A sufficiently obfuscated call site bypasses this check; the
   * reviewer is the second gate.
   */
  it('no src file outside the definition sites imports or mentions the adoption primitive', () => {
    const allowed = new Set([
      path.normalize('src/core/rotation-adoption.ts'),
      path.normalize('src/core/api-key-rotation.ts'),
    ]);
    const symbols = [
      'adoptPreVerifiedBearer',
      'VerifiedLegacyBearer',
      'AdoptionBearerFormatError',
      'AdoptionBearerCollisionError',
    ];

    const offenders: { file: string; symbol: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const rel = path.normalize(path.relative(process.cwd(), full));
        if (allowed.has(rel)) continue;
        const source = readFileSync(full, 'utf8');
        for (const symbol of symbols) {
          if (source.includes(symbol)) {
            offenders.push({ file: rel, symbol });
          }
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });

  it('src/middleware/auth.ts is untouched — no rotation symbols at all', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src', 'middleware', 'auth.ts'),
      'utf8',
    );
    for (const symbol of [
      'rotation',
      'adopt',
      'ClawNetApiKeyBackend',
      'CredentialRotationController',
      'lookupByBearer',
    ]) {
      expect(
        source.toLowerCase().includes(symbol.toLowerCase()),
        `auth.ts unexpectedly mentions ${symbol}`,
      ).toBe(false);
    }
  });
});
