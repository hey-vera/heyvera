import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import {
  insertPendingCeremony,
  getPendingCeremony,
  getAwaitingCeremonies,
  completeCeremony,
  expireOldCeremonies,
  getActiveNonRecoveryCredentials,
  getCredentialByCredentialId,
  updateCredentialCounter,
  updateCredentialLastUsed,
} from '../db/index';
import {
  generateCeremonyChallenge,
  verifyCeremonyResponse,
  storeChallenge,
  consumeChallenge,
} from '../core/webauthn';
import { getHeart } from '../core/soma-heart';
import { logger } from '../utils/logger';

export const ceremonyRouter = new Hono();

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

// ─── POST /request ────────────────────────────────────────────────────────────

ceremonyRouter.post('/request', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  const {
    package: packageName,
    targetVersion,
    tarballSha256,
    gitCommit,
    releaseLogSequence,
    releaseLogEntryHash,
  } = body as {
    package: string;
    targetVersion: string;
    tarballSha256: string;
    gitCommit: string;
    releaseLogSequence?: number;
    releaseLogEntryHash?: string;
  };

  if (!packageName || typeof packageName !== 'string') {
    return c.json({ error: 'package is required', code: 'INVALID_INPUT' }, 400);
  }
  if (!targetVersion || typeof targetVersion !== 'string') {
    return c.json({ error: 'targetVersion is required', code: 'INVALID_INPUT' }, 400);
  }
  if (!SHA256_HEX.test(tarballSha256)) {
    return c.json({ error: 'tarballSha256 must be 64-char lowercase hex', code: 'INVALID_INPUT' }, 400);
  }
  if (!GIT_SHA.test(gitCommit)) {
    return c.json({ error: 'gitCommit must be 40-char lowercase hex', code: 'INVALID_INPUT' }, 400);
  }

  expireOldCeremonies();

  const id = nanoid();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  insertPendingCeremony({
    id,
    package_name: packageName,
    target_version: targetVersion,
    tarball_sha256: tarballSha256,
    git_commit: gitCommit,
    release_log_sequence: releaseLogSequence ?? null,
    release_log_entry_hash: releaseLogEntryHash ?? null,
    status: 'awaiting_webauthn',
    expires_at: expiresAt,
  });

  logger.info({ ceremonyId: id, package: packageName, version: targetVersion }, 'ceremony request created');

  return c.json({ ok: true, ceremonyId: id, expiresAt });
});

// ─── GET /pending ─────────────────────────────────────────────────────────────

ceremonyRouter.get('/pending', (c) => {
  const ceremonies = getAwaitingCeremonies().map(({ certificate_json: _, ...rest }) => rest);
  return c.json({ ceremonies });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

ceremonyRouter.get('/:id', (c) => {
  const ceremony = getPendingCeremony(c.req.param('id'));
  if (!ceremony) {
    return c.json({ error: 'Ceremony not found', code: 'NOT_FOUND' }, 404);
  }
  return c.json(ceremony);
});

// ─── POST /:id/approve/options ────────────────────────────────────────────────

ceremonyRouter.post('/:id/approve/options', async (c) => {
  const ceremony = getPendingCeremony(c.req.param('id'));
  if (!ceremony || ceremony.status !== 'awaiting_webauthn') {
    return c.json({ error: 'Ceremony not found or not awaiting approval', code: 'INVALID_STATE' }, 400);
  }

  if (new Date(ceremony.expires_at) <= new Date()) {
    expireOldCeremonies();
    return c.json({ error: 'Ceremony expired', code: 'EXPIRED' }, 400);
  }

  const credentials = getActiveNonRecoveryCredentials();
  if (credentials.length === 0) {
    return c.json({ error: 'No credentials enrolled', code: 'NO_CREDENTIALS' }, 400);
  }

  const challengeKey = nanoid();
  const options = await generateCeremonyChallenge(
    credentials.map((cred) => ({
      id: cred.credential_id,
      transports: cred.transports ?? undefined,
    })),
  );
  storeChallenge(challengeKey, options.challenge);

  return c.json({ options, challengeKey });
});

// ─── POST /:id/approve/verify ─────────────────────────────────────────────────

ceremonyRouter.post('/:id/approve/verify', async (c) => {
  const ceremonyId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  const { response, challengeKey } = body as {
    response: AuthenticationResponseJSON;
    challengeKey: string;
  };

  if (!response || !challengeKey) {
    return c.json({ error: 'response and challengeKey are required', code: 'INVALID_INPUT' }, 400);
  }

  const ceremony = getPendingCeremony(ceremonyId);
  if (!ceremony || ceremony.status !== 'awaiting_webauthn') {
    return c.json({ error: 'Ceremony not found or not awaiting approval', code: 'INVALID_STATE' }, 400);
  }

  const challenge = consumeChallenge(challengeKey);
  if (!challenge) {
    return c.json({ error: 'Invalid or expired challenge', code: 'CHALLENGE_INVALID' }, 400);
  }

  const credential = getCredentialByCredentialId(response.id);
  if (!credential || credential.status !== 'active') {
    return c.json({ error: 'Credential not found or inactive', code: 'CREDENTIAL_INVALID' }, 400);
  }

  let verification;
  try {
    verification = await verifyCeremonyResponse(response, challenge, {
      credentialID: credential.credential_id,
      credentialPublicKey: credential.public_key,
      counter: credential.counter,
    });
  } catch {
    return c.json({ error: 'Ceremony verification failed', code: 'VERIFICATION_FAILED' }, 400);
  }

  if (!verification.verified) {
    return c.json({ error: 'Ceremony verification failed', code: 'VERIFICATION_FAILED' }, 400);
  }

  updateCredentialCounter(credential.id, verification.authenticationInfo.newCounter);
  updateCredentialLastUsed(credential.id);

  // TODO(webauthn-phase-1): Replace stub with real certificate creation
  // Once soma-heart 0.9.0 exports ./supply-chain:
  //
  //   import { createUpdateCertificate, addAuthorization } from 'soma-heart/supply-chain';
  //
  //   const cert = createUpdateCertificate({
  //     package: ceremony.package_name,
  //     version: ceremony.target_version,
  //     tarballSha256: ceremony.tarball_sha256,
  //     gitCommit: ceremony.git_commit,
  //     maintainerDid: founderDid,
  //     role: 'maintainer',
  //     ceremonyTier: 'L2',
  //   });
  //   const signed = addAuthorization(cert, getHeart(), {
  //     role: 'consumer-heart',
  //   });
  const placeholderCertificate = {
    _stub: true,
    _todo: 'Replace with createUpdateCertificate() + addAuthorization() when soma-heart exports ./supply-chain (0.9.0)',
    package: ceremony.package_name,
    version: ceremony.target_version,
    tarballSha256: ceremony.tarball_sha256,
    gitCommit: ceremony.git_commit,
    maintainerDid: 'pending-soma-heart-0.9.0',
    consumerHeartDid: getHeart().did,
    ceremonyTier: 'L2',
    threshold: 2,
    webauthnCredentialId: credential.id,
    authenticatorEcosystem: credential.ecosystem,
    completedAt: new Date().toISOString(),
  };

  logger.info({ ceremonyId, stub: true }, 'ceremony: completed (certificate stub — awaiting soma-heart 0.9.0 supply-chain export)');

  completeCeremony(ceremonyId, {
    credentialId: credential.id,
    kind: credential.ecosystem,
    certificateJson: JSON.stringify(placeholderCertificate),
  });

  return c.json({
    ok: true,
    ceremonyId,
    status: 'completed',
    authenticator: { ecosystem: credential.ecosystem, role: credential.role },
    certificate: placeholderCertificate,
  });
});
