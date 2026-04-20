import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import { env } from '../config/index';

const RP_NAME = 'ClawNet Soma Signing';
const RP_ID = env.WEBAUTHN_RP_ID;
const RP_ORIGIN = env.WEBAUTHN_RP_ORIGIN;

// ─── Challenge store (in-memory, TTL-based) ─────────────────────────────────

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

const pendingChallenges = new Map<string, PendingChallenge>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function cleanExpiredChallenges(): void {
  const now = Date.now();
  for (const [key, val] of pendingChallenges) {
    if (val.expiresAt <= now) pendingChallenges.delete(key);
  }
}

export function storeChallenge(key: string, challenge: string): void {
  cleanExpiredChallenges();
  pendingChallenges.set(key, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

export function consumeChallenge(key: string): string | null {
  const entry = pendingChallenges.get(key);
  if (!entry) return null;
  pendingChallenges.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}

// ─── Registration (enrollment) ──────────────────────────────────────────────

export async function generateEnrollmentOptions(
  userId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: userId,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    supportedAlgorithmIDs: [-7, -257],
    attestationType: 'none',
  });
}

export async function verifyEnrollment(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<VerifiedRegistrationResponse> {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
  });
}

// ─── Authentication (ceremony) ──────────────────────────────────────────────

export async function generateCeremonyChallenge(
  allowedCredentials: Array<{
    id: string;
    transports?: string;
  }>,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: allowedCredentials.map((cred) => ({
      id: cred.id,
      transports: cred.transports
        ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
  });
}

export async function verifyCeremonyResponse(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: {
    credentialID: string;
    credentialPublicKey: string;
    counter: number;
  },
): Promise<VerifiedAuthenticationResponse> {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: credential.credentialID,
      publicKey: Buffer.from(credential.credentialPublicKey, 'base64url'),
      counter: credential.counter,
    },
  });
}
