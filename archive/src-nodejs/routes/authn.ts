import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import {
  getDb,
  insertWebAuthnCredential,
  getCredentialByCredentialId,
  getActiveNonRecoveryCredentials,
  getActiveCredentialsByRole,
  getCredentialRoster,
  updateCredentialCounter,
  updateCredentialLastUsed,
  revokeCredential,
  countActiveNonRecoveryCredentials,
  promoteToPrimary,
  type WebAuthnCredential,
} from '../db/index';
import {
  generateEnrollmentOptions,
  verifyEnrollment,
  generateCeremonyChallenge,
  verifyCeremonyResponse,
  storeChallenge,
  consumeChallenge,
} from '../core/webauthn';

export const authnRouter = new Hono();

const VALID_ECOSYSTEMS = ['apple', 'google', 'yubikey', 'other'] as const;
const VALID_ROLES = ['primary', 'backup', 'recovery'] as const;

function getCredentialById(id: string): WebAuthnCredential | undefined {
  return getDb()
    .prepare('SELECT * FROM webauthn_credentials WHERE id = ?')
    .get(id) as WebAuthnCredential | undefined;
}

// ─── POST /register/options ────────────────────────────────────────────────

authnRouter.post('/register/options', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  const { ecosystem, intendedRole } = body;

  if (!VALID_ECOSYSTEMS.includes(ecosystem as (typeof VALID_ECOSYSTEMS)[number])) {
    return c.json({ error: 'ecosystem must be apple, google, yubikey, or other', code: 'INVALID_INPUT' }, 400);
  }
  if (!VALID_ROLES.includes(intendedRole as (typeof VALID_ROLES)[number])) {
    return c.json({ error: 'intendedRole must be primary, backup, or recovery', code: 'INVALID_INPUT' }, 400);
  }

  const challengeKey = nanoid();
  const options = await generateEnrollmentOptions('founder');
  storeChallenge(challengeKey, options.challenge);

  return c.json({ options, challengeKey });
});

// ─── POST /register/verify ─────────────────────────────────────────────────

authnRouter.post('/register/verify', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  const { response, challengeKey, ecosystem, intendedRole } = body as {
    response: RegistrationResponseJSON;
    challengeKey: string;
    ecosystem: string;
    intendedRole: string;
  };

  if (!response || !challengeKey || !ecosystem || !intendedRole) {
    return c.json({ error: 'response, challengeKey, ecosystem, and intendedRole are required', code: 'INVALID_INPUT' }, 400);
  }

  const challenge = consumeChallenge(challengeKey);
  if (!challenge) {
    return c.json({ error: 'Invalid or expired challenge', code: 'CHALLENGE_INVALID' }, 400);
  }

  let verification;
  try {
    verification = await verifyEnrollment(response, challenge);
  } catch {
    return c.json({ error: 'Registration verification failed', code: 'VERIFICATION_FAILED' }, 400);
  }

  if (!verification.verified) {
    return c.json({ error: 'Registration verification failed', code: 'VERIFICATION_FAILED' }, 400);
  }

  const { credential, aaguid } = verification.registrationInfo;

  // Enforce registry invariants (§4.2)
  if (intendedRole === 'primary') {
    getDb()
      .prepare(`UPDATE webauthn_credentials SET role = 'backup' WHERE role = 'primary' AND status = 'active'`)
      .run();
  }
  if (intendedRole === 'recovery') {
    const existingRecovery = getActiveCredentialsByRole('recovery');
    for (const r of existingRecovery) {
      revokeCredential(r.id);
    }
  }

  const credId = nanoid();
  insertWebAuthnCredential({
    id: credId,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    aaguid,
    ecosystem,
    role: intendedRole,
  });

  return c.json({ ok: true, credentialId: credId });
});

// ─── POST /authenticate/options ────────────────────────────────────────────

authnRouter.post('/authenticate/options', async (c) => {
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

// ─── POST /authenticate/verify ─────────────────────────────────────────────

authnRouter.post('/authenticate/verify', async (c) => {
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
    return c.json({ error: 'Authentication verification failed', code: 'VERIFICATION_FAILED' }, 400);
  }

  if (!verification.verified) {
    return c.json({ error: 'Authentication verification failed', code: 'VERIFICATION_FAILED' }, 400);
  }

  updateCredentialCounter(credential.id, verification.authenticationInfo.newCounter);
  updateCredentialLastUsed(credential.id);

  return c.json({
    ok: true,
    credentialId: credential.id,
    ecosystem: credential.ecosystem,
  });
});

// TODO: Phase 2 should require WebAuthn re-auth before promote/revoke

// ─── POST /promote ─────────────────────────────────────────────────────────

authnRouter.post('/promote', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  const { credentialId } = body as { credentialId: string };
  if (!credentialId) {
    return c.json({ error: 'credentialId is required', code: 'INVALID_INPUT' }, 400);
  }

  const credential = getCredentialById(credentialId);
  if (!credential) {
    return c.json({ error: 'Credential not found', code: 'NOT_FOUND' }, 400);
  }
  if (credential.status !== 'active') {
    return c.json({ error: 'Credential is not active', code: 'CREDENTIAL_INVALID' }, 400);
  }
  if (credential.role === 'primary') {
    return c.json({ error: 'Credential is already primary', code: 'ALREADY_PRIMARY' }, 400);
  }

  promoteToPrimary(credentialId);

  return c.json({ ok: true, roster: getCredentialRoster() });
});

// ─── POST /revoke ──────────────────────────────────────────────────────────

authnRouter.post('/revoke', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  const { credentialId } = body as { credentialId: string };
  if (!credentialId) {
    return c.json({ error: 'credentialId is required', code: 'INVALID_INPUT' }, 400);
  }

  const credential = getCredentialById(credentialId);
  if (!credential) {
    return c.json({ error: 'Credential not found', code: 'NOT_FOUND' }, 400);
  }
  if (credential.status !== 'active') {
    return c.json({ error: 'Credential is not active', code: 'CREDENTIAL_INVALID' }, 400);
  }

  if (credential.role !== 'recovery' && countActiveNonRecoveryCredentials() <= 1) {
    return c.json({ error: 'Cannot revoke the last active credential', code: 'LAST_CREDENTIAL' }, 400);
  }

  revokeCredential(credentialId);

  return c.json({ ok: true, roster: getCredentialRoster() });
});

// ─── GET /roster ───────────────────────────────────────────────────────────

authnRouter.get('/roster', (c) => {
  const roster = getCredentialRoster().map((cred) => ({
    id: cred.id,
    credential_id: cred.credential_id.slice(-8),
    ecosystem: cred.ecosystem,
    role: cred.role,
    status: cred.status,
    created_at: cred.created_at,
    last_used_at: cred.last_used_at,
    revoked_at: cred.revoked_at,
  }));

  return c.json({ roster });
});
