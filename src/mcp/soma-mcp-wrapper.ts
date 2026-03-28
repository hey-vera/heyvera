/**
 * Soma MCP Wrapper — embeds Soma identity in ClawNet's MCP server.
 *
 * Adds Soma metadata (genome commitment + ephemeral X25519 public key) to the
 * MCP initialize response so callers running soma-sense can:
 *   1. Verify ClawNet's genome commitment (what model it claims to run)
 *   2. Establish an X25519 encrypted channel for behavioral verification
 *   3. Run temporal fingerprinting on the token stream
 *
 * This makes ClawNet verifiable via MCP — callers don't need to trust,
 * they can verify. The heart runs on ClawNet's side, the sense runs on theirs.
 *
 * Uses tweetnacl (already a dependency via soma-heart) for X25519 key generation.
 * Does NOT import from the root Soma repo — only uses soma-heart (on npm).
 */

import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { getHeartSafe } from '../core/soma';
import { logger } from '../utils/logger';

const SOMA_METADATA_KEY = '_soma';

// Ephemeral X25519 key pair for this server session
let _ephemeralKeyPair: nacl.BoxKeyPair | null = null;

function getEphemeralKeyPair(): nacl.BoxKeyPair {
  if (!_ephemeralKeyPair) {
    _ephemeralKeyPair = nacl.box.keyPair();
  }
  return _ephemeralKeyPair;
}

/**
 * Build Soma metadata block for MCP initialize response.
 * Returns null if heart is not active.
 *
 * This gets embedded in the MCP server's `serverInfo` during the initialize
 * handshake. A soma-sense client will detect it and start the verification flow.
 */
export function buildSomaMetadata(): Record<string, unknown> | null {
  const heart = getHeartSafe();
  if (!heart) return null;

  const ephemeral = getEphemeralKeyPair();

  return {
    [SOMA_METADATA_KEY]: {
      genomeCommitment: heart.genomeCommitment,
      ephemeralPublicKey: encodeBase64(ephemeral.publicKey),
    },
  };
}

/**
 * Get the ephemeral secret key for X25519 key exchange (used if a sense connects).
 * Only expose within this module — never send over the wire.
 */
export function getEphemeralSecretKey(): Uint8Array | null {
  return _ephemeralKeyPair?.secretKey ?? null;
}

/**
 * Reset the ephemeral key pair (for key rotation on reconnect).
 */
export function rotateEphemeralKeys(): void {
  _ephemeralKeyPair = nacl.box.keyPair();
  logger.info('Soma MCP ephemeral keys rotated');
}

/**
 * Log Soma MCP status for debugging.
 */
export function logSomaMcpStatus(): void {
  const heart = getHeartSafe();
  if (heart) {
    logger.info({
      somaDid: heart.did,
      genomeHash: heart.genomeCommitment?.hash?.slice(0, 16),
      ephemeralKeyReady: !!_ephemeralKeyPair,
    }, 'Soma MCP: ready for sense connections');
  } else {
    logger.info('Soma MCP: heart not active, running without verification');
  }
}
