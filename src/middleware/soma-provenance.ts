/**
 * Soma Provenance Headers — attach X-Soma-* headers to responses.
 *
 * When the Soma Heart is active and a birth certificate exists from the most
 * recent API call, these headers let ANY x402 client verify data provenance
 * without parsing the response body.
 *
 * Headers:
 *   X-Soma-Protocol: soma/1.0
 *   X-Soma-Data-Hash: <sha256 of response data>
 *   X-Soma-Signature: <ed25519 signature over data hash>
 *   X-Soma-Heartbeat-Index: <sequence in heartbeat chain>
 *   X-Soma-Genome-Hash: <genome commitment hash>
 *   X-Soma-Public-Key: <hex ed25519 public key>
 *   X-Soma-Discovery: /.well-known/soma.json
 *
 * These headers define how provenance travels in x402 responses.
 * Any x402 client can verify: hash the response body, check the signature
 * against the public key, confirm the genome hash matches the discovery endpoint.
 */

import type { MiddlewareHandler } from 'hono';
import { getHeartSafe } from '../core/soma';
import { getLastBirthCertificate } from '../providers/clawapis';
import { getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { logger } from '../utils/logger';

let loggedOnce = false;

export const somaProvenance: MiddlewareHandler = async (c, next) => {
  await next();

  const heart = getHeartSafe();
  if (!heart) return;

  const cert = getLastBirthCertificate();
  if (!cert) return;

  try {
    c.res.headers.set('X-Soma-Protocol', 'soma/1.0');
    c.res.headers.set('X-Soma-Data-Hash', cert.dataHash);
    c.res.headers.set('X-Soma-Signature', cert.signature);
    c.res.headers.set('X-Soma-Heartbeat-Index', String(cert.heartbeatIndex));
    c.res.headers.set('X-Soma-Public-Key', cert.publicKey);
    c.res.headers.set('X-Soma-Discovery', '/.well-known/soma.json');

    // Add genome hash if available
    if (heart.genomeCommitment?.hash) {
      c.res.headers.set('X-Soma-Genome-Hash', heart.genomeCommitment.hash);
    }

    if (!loggedOnce) {
      logger.info('Soma provenance headers active — X-Soma-* headers attached to responses');
      loggedOnce = true;
    }
  } catch (err) {
    logger.warn({ err }, 'Soma provenance header attachment failed — sending without headers');
  }
};
