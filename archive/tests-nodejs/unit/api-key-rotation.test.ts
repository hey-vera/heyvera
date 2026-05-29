/**
 * Unit tests — ClawNetApiKeyBackend driven through the Soma
 * CredentialRotationController.
 *
 * These tests instantiate a real `CredentialRotationController`
 * (not a mock) and drive the backend through it on every path:
 * incept → anchor → witness → sign → verify → rotate → commit →
 * ackPropagation → verify rejects old. That's exactly how the
 * middleware cutover in PR #7 will drive the stack, so any bug
 * that would show up in middleware also shows up here.
 *
 * The controller is **not** instantiated anywhere in the running
 * server by this PR — it lives only inside this test file. The
 * backend ships inert.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CredentialRotationController,
  DEFAULT_POLICY,
  StagedRotationConflict,
} from 'soma-heart/credential-rotation';

import { _resetDbForTests, closeDb, initDb } from '../../src/db/index';
import { ClawNetApiKeyBackend } from '../../src/core/api-key-rotation';

function makeStack(clockMs = 1_700_000_000_000) {
  const db = initDb({ path: ':memory:' });
  const clock = { t: clockMs };
  const backend = new ClawNetApiKeyBackend({ db });
  const controller = new CredentialRotationController({
    policy: {
      ...DEFAULT_POLICY,
      backendAllowlist: [backend.backendId],
      // Loosen D3 so the test doesn't trip the rate limit during a
      // multi-rotation run; rate limiting is covered by Soma's own
      // suite.
      maxRotationsPerHour: 1000,
      rotationBurst: 100,
    },
    clock: () => clock.t,
  });
  controller.registerBackend(backend);
  return { backend, controller, clock, db };
}

async function driveToEffective(
  controller: CredentialRotationController,
  identityId: string,
  eventHash: string,
): Promise<void> {
  controller.anchorEvent(identityId, eventHash, `root-${eventHash}`);
  controller.witnessEvent(identityId, eventHash);
}

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  closeDb();
});

describe('ClawNetApiKeyBackend — controller-driven', () => {
  it('incept → anchor → witness → sign → verify (happy path)', async () => {
    const { backend, controller } = makeStack();
    const { event, credential } = await controller.incept({
      identityId: 'id-1',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-1', event.hash);

    expect(credential.credentialId).toMatch(/^cn-[a-f0-9]{48}$/);
    expect(credential.algorithmSuite).toBe('ed25519');
    expect(credential.class).toBe('A');

    const current = controller.getCurrentCredential('id-1');
    expect(current?.credentialId).toBe(credential.credentialId);

    const msg = new TextEncoder().encode('hello');
    const sig = await controller.sign('id-1', msg);
    const ok = await controller.verify('id-1', msg, sig);
    expect(ok).toBe(true);
  });

  it('rotate: new credential signs PoP, verify accepts both during grace window', async () => {
    const { backend, controller, clock } = makeStack();
    const first = await controller.incept({
      identityId: 'id-2',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-2', first.event.hash);

    // Produce a signature from the FIRST credential before rotating.
    const msg = new TextEncoder().encode('pre-rotation message');
    const oldSig = await controller.sign('id-2', msg);

    clock.t += 60_000;
    const second = await controller.rotate('id-2');
    await driveToEffective(controller, 'id-2', second.event.hash);

    expect(second.credential.credentialId).not.toBe(first.credential.credentialId);
    expect(backend.getCurrentCredentialId('id-2')).toBe(
      second.credential.credentialId,
    );

    // Old signature still verifies during the grace window (invariant 12).
    const stillOk = await controller.verify('id-2', msg, oldSig);
    expect(stillOk).toBe(true);

    // New credential can sign a fresh message.
    const newMsg = new TextEncoder().encode('post-rotation message');
    const newSig = await controller.sign('id-2', newMsg);
    expect(await controller.verify('id-2', newMsg, newSig)).toBe(true);
  });

  it('ackPropagation revokes old credential in backend with 64-byte zero-fill (P0.2)', async () => {
    const { backend, controller, db } = makeStack();
    const first = await controller.incept({
      identityId: 'id-3',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-3', first.event.hash);

    const second = await controller.rotate('id-3');
    await driveToEffective(controller, 'id-3', second.event.hash);
    await controller.ackPropagation('id-3', first.credential.credentialId);

    const row = db
      .prepare(
        'SELECT revoked, secret_key FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(first.credential.credentialId) as {
      revoked: number;
      secret_key: string;
    };
    expect(row.revoked).toBe(1);
    // P0.2 regression: revoked rows must hold 64 zero bytes (Ed25519
    // secret length), not 32. The column stores base64, so decoding
    // must yield exactly 64 bytes and every byte must be 0.
    const decoded = Buffer.from(row.secret_key, 'base64');
    expect(decoded.length).toBe(64);
    expect(decoded.every((b) => b === 0)).toBe(true);

    // Backend-level guards match the DB state.
    expect(backend.lookupByBearer(first.credential.credentialId, Date.now())).toBeNull();
    await expect(
      backend.signWithCredential(
        first.credential.credentialId,
        new Uint8Array(4),
      ),
    ).rejects.toThrow(/revoked/);
  });

  it('lookupByBearer returns null for unknown, revoked, and expired credentials', async () => {
    const { backend, controller, db } = makeStack();
    const first = await controller.incept({
      identityId: 'id-4',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-4', first.event.hash);

    // Unknown
    expect(backend.lookupByBearer('cn-' + 'a'.repeat(48), 1)).toBeNull();

    // Live
    const live = backend.lookupByBearer(first.credential.credentialId, 1);
    expect(live?.identityId).toBe('id-4');

    // Expired (advance now past expiresAt)
    const expired = backend.lookupByBearer(
      first.credential.credentialId,
      live!.expiresAt + 1,
    );
    expect(expired).toBeNull();

    // Revoked
    db.prepare(
      'UPDATE api_key_rotation_credentials SET revoked = 1 WHERE credential_id = ?',
    ).run(first.credential.credentialId);
    expect(
      backend.lookupByBearer(first.credential.credentialId, 1),
    ).toBeNull();
  });

  it('stageNextCredential throws StagedRotationConflict when called twice', async () => {
    const { backend, controller } = makeStack();
    const first = await controller.incept({
      identityId: 'id-5',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-5', first.event.hash);

    // Drive one stage through the backend directly (bypassing the
    // controller) so we can assert the second call conflicts.
    await backend.stageNextCredential({
      identityId: 'id-5',
      oldCredentialId: first.credential.credentialId,
      issuedAt: Date.now(),
    });
    await expect(
      backend.stageNextCredential({
        identityId: 'id-5',
        oldCredentialId: first.credential.credentialId,
        issuedAt: Date.now(),
      }),
    ).rejects.toBeInstanceOf(StagedRotationConflict);
  });

  it('discardIdentity wipes both tables and is idempotent', async () => {
    const { backend, controller, db } = makeStack();
    const first = await controller.incept({
      identityId: 'id-6',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-6', first.event.hash);

    await backend.discardIdentity('id-6');
    const credCount = (
      db
        .prepare(
          'SELECT COUNT(*) as n FROM api_key_rotation_credentials WHERE identity_id = ?',
        )
        .get('id-6') as { n: number }
    ).n;
    const identCount = (
      db
        .prepare(
          'SELECT COUNT(*) as n FROM api_key_rotation_identities WHERE identity_id = ?',
        )
        .get('id-6') as { n: number }
    ).n;
    expect(credCount).toBe(0);
    expect(identCount).toBe(0);

    // Second call is a no-op (not a throw).
    await backend.discardIdentity('id-6');
  });

  it('AAD binding: ciphertext from one credential row cannot be pasted into another', async () => {
    // This is the AAD-contract regression: `encryptSecret` binds the
    // credentialId into the AEAD tag, so copying `secret_key` from row
    // A into row B must fail decryption on sign. If this test ever
    // starts passing a sign call after the paste, the AAD contract
    // documented in the backend file header is broken.
    const { backend, controller, db } = makeStack();
    const a = await controller.incept({
      identityId: 'id-7a',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-7a', a.event.hash);
    const b = await controller.incept({
      identityId: 'id-7b',
      backendId: backend.backendId,
    });
    await driveToEffective(controller, 'id-7b', b.event.hash);

    const rowA = db
      .prepare(
        'SELECT secret_key FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(a.credential.credentialId) as { secret_key: string };

    // Paste A's ciphertext into B's row.
    db.prepare(
      'UPDATE api_key_rotation_credentials SET secret_key = ? WHERE credential_id = ?',
    ).run(rowA.secret_key, b.credential.credentialId);

    // B's sign path should now reject — AAD is bound to B's id, but
    // the ciphertext was sealed under A's id.
    await expect(
      backend.signWithCredential(
        b.credential.credentialId,
        new TextEncoder().encode('x'),
      ),
    ).rejects.toThrow();
  });
});
