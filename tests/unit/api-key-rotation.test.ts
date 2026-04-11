/**
 * Unit tests — ClawNetApiKeyBackend driven through the Soma
 * CredentialRotationController.
 *
 * These are end-to-end tests against the real Soma primitive (not a
 * mock): inception → anchor → witness → sign → rotate → commit →
 * reject-rotation-when-tip-not-effective → revoke.  We go through the
 * controller on every path so the backend is exercised exactly the
 * way middleware will drive it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CredentialRotationController,
  DEFAULT_POLICY,
  NotYetEffective,
  verifyRotationChain,
} from 'soma-heart/credential-rotation';
import { getCryptoProvider } from 'soma-heart/crypto-provider';

import { setupTestDb, getTestDb } from './helpers/db';

setupTestDb();

import { initDb } from '../../src/db/index';
import { ClawNetApiKeyBackend } from '../../src/core/api-key-rotation';

const crypto = getCryptoProvider();

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  const db = getTestDb();
  db.prepare('DELETE FROM api_key_rotation_credentials').run();
  db.prepare('DELETE FROM api_key_rotation_identities').run();
});

function makeStack(clockMs = 1_700_000_000_000) {
  const clock = { t: clockMs };
  const backend = new ClawNetApiKeyBackend({ db: getTestDb() });
  const controller = new CredentialRotationController({
    policy: {
      ...DEFAULT_POLICY,
      backendAllowlist: [backend.backendId],
      // Loosen D3 so the test doesn't trip the rate limit during a
      // multi-rotation run; rate limiting is covered by Soma's own suite.
      maxRotationsPerHour: 1000,
      rotationBurst: 100,
    },
    clock: () => clock.t,
  });
  controller.registerBackend(backend);
  return { backend, controller, clock };
}

function driveToEffective(
  controller: CredentialRotationController,
  identityId: string,
  eventHash: string,
): void {
  controller.anchorEvent(identityId, eventHash, `pulse-root-${eventHash.slice(0, 8)}`);
  controller.witnessEvent(identityId, eventHash);
}

describe('ClawNetApiKeyBackend', () => {
  it('incepts, anchors, witnesses and promotes to current', async () => {
    const { backend, controller } = makeStack();

    const { event, credential } = await controller.incept({
      identityId: 'id-customer-1',
      backendId: backend.backendId,
    });

    // Before anchor + witness: no `current` yet (L3).
    expect(controller.getCurrentCredential('id-customer-1')).toBeNull();

    driveToEffective(controller, 'id-customer-1', event.hash);

    const current = controller.getCurrentCredential('id-customer-1');
    expect(current?.credentialId).toBe(credential.credentialId);
    expect(current?.backendId).toBe('clawnet-api-key');
    expect(current?.algorithmSuite).toBe('ed25519');
    expect(current?.class).toBe('A');
    expect(credential.credentialId).toMatch(/^cn-[a-f0-9]{48}$/);
  });

  it('persists the credential row in SQLite', async () => {
    const { backend, controller } = makeStack();
    const { event, credential } = await controller.incept({
      identityId: 'id-customer-2',
      backendId: backend.backendId,
    });
    driveToEffective(controller, 'id-customer-2', event.hash);

    const row = getTestDb()
      .prepare(
        'SELECT identity_id, algorithm_suite, class, revoked, expires_at FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(credential.credentialId) as {
        identity_id: string;
        algorithm_suite: string;
        class: string;
        revoked: number;
        expires_at: number;
      };
    expect(row.identity_id).toBe('id-customer-2');
    expect(row.algorithm_suite).toBe('ed25519');
    expect(row.class).toBe('A');
    expect(row.revoked).toBe(0);
    expect(row.expires_at).toBeGreaterThan(credential.issuedAt);
  });

  it('signs and verifies messages through the controller', async () => {
    const { backend, controller } = makeStack();
    const { event } = await controller.incept({
      identityId: 'id-sign',
      backendId: backend.backendId,
    });
    driveToEffective(controller, 'id-sign', event.hash);

    const message = new TextEncoder().encode('hello from claw-net');
    const signature = await controller.sign('id-sign', message);
    const ok = await controller.verify('id-sign', message, signature);
    expect(ok).toBe(true);

    const tampered = new TextEncoder().encode('hello from elsewhere');
    const bad = await controller.verify('id-sign', tampered, signature);
    expect(bad).toBe(false);
  });

  it('rotates transactionally and preserves the chain', async () => {
    const { backend, controller, clock } = makeStack();
    const { event: inceptEvent, credential: first } = await controller.incept({
      identityId: 'id-rotate',
      backendId: backend.backendId,
    });
    driveToEffective(controller, 'id-rotate', inceptEvent.hash);

    clock.t += 5_000;
    const { event: rotateEvent, credential: second } =
      await controller.rotate('id-rotate');
    expect(second.credentialId).not.toBe(first.credentialId);

    driveToEffective(controller, 'id-rotate', rotateEvent.hash);
    expect(controller.getCurrentCredential('id-rotate')?.credentialId).toBe(
      second.credentialId,
    );

    const verdict = verifyRotationChain(
      controller.getEvents('id-rotate'),
      crypto,
    );
    expect(verdict).toEqual({ valid: true });
  });

  it('refuses a second rotation while the prior is pending', async () => {
    const { backend, controller, clock } = makeStack();
    const { event } = await controller.incept({
      identityId: 'id-flight',
      backendId: backend.backendId,
    });
    driveToEffective(controller, 'id-flight', event.hash);

    clock.t += 1_000;
    await controller.rotate('id-flight'); // tip is now pending/anchored/witnessed, not effective
    clock.t += 1_000;
    await expect(controller.rotate('id-flight')).rejects.toBeInstanceOf(
      NotYetEffective,
    );
  });

  it('lookupByBearer returns identity for live creds and null for expired/revoked', async () => {
    const { backend, controller, clock } = makeStack();
    const { event, credential } = await controller.incept({
      identityId: 'id-lookup',
      backendId: backend.backendId,
    });
    driveToEffective(controller, 'id-lookup', event.hash);

    expect(backend.lookupByBearer(credential.credentialId, clock.t)).toEqual({
      identityId: 'id-lookup',
      expiresAt: credential.expiresAt,
    });

    // Expired → null.
    expect(
      backend.lookupByBearer(credential.credentialId, credential.expiresAt + 1),
    ).toBeNull();

    // Unknown → null.
    expect(backend.lookupByBearer('cn-' + 'a'.repeat(48), clock.t)).toBeNull();

    // Revoke and re-check at a fresh time: lookup returns null.
    await backend.revokeCredential(credential.credentialId);
    expect(backend.lookupByBearer(credential.credentialId, clock.t)).toBeNull();
  });

  it('discardIdentity wipes both tables and is idempotent', async () => {
    const { backend, controller } = makeStack();
    const { event } = await controller.incept({
      identityId: 'id-discard',
      backendId: backend.backendId,
    });
    driveToEffective(controller, 'id-discard', event.hash);

    await backend.discardIdentity('id-discard');
    const db = getTestDb();
    const creds = db
      .prepare(
        'SELECT COUNT(*) as c FROM api_key_rotation_credentials WHERE identity_id = ?',
      )
      .get('id-discard') as { c: number };
    const idents = db
      .prepare(
        'SELECT COUNT(*) as c FROM api_key_rotation_identities WHERE identity_id = ?',
      )
      .get('id-discard') as { c: number };
    expect(creds.c).toBe(0);
    expect(idents.c).toBe(0);

    // Idempotent.
    await expect(backend.discardIdentity('id-discard')).resolves.toBeUndefined();
    await expect(backend.discardIdentity('nope')).resolves.toBeUndefined();
  });
});
