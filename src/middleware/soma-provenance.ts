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
import { getHeartSafe, getLastGenerationProvenance } from '../core/soma';
import { getLastBirthCertificate } from '../providers/x402-client';
import { getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { getProvenance } from '../core/request-context';
import { logger } from '../utils/logger';

let loggedOnce = false;

export const somaProvenance: MiddlewareHandler = async (c, next) => {
  await next();

  const heart = getHeartSafe();
  if (!heart) return;

  try {
    // Always set protocol + discovery + genome
    c.res.headers.set('X-Soma-Protocol', 'soma/1.0');
    c.res.headers.set('X-Soma-Discovery', '/.well-known/soma.json');
    if (heart.genomeCommitment?.hash) {
      c.res.headers.set('X-Soma-Genome-Hash', heart.genomeCommitment.hash);
    }

    // ── Dual-sign headers (takes priority over single-sign) ─────────────
    const dualSign = getProvenance('dualSign') as import('../core/dual-sign-state').DualSignResult | null;
    if (dualSign) {
      // Dual-sign meta
      c.res.headers.set('X-Soma-Dual-Signed', 'true');
      c.res.headers.set('X-Soma-Chain-Hash', dualSign.chainHash);
      c.res.headers.set('X-Soma-Provider-Verified', String(dualSign.providerVerified));

      // Provider cert headers
      c.res.headers.set('X-Soma-Provider-Data-Hash', dualSign.provider.dataHash);
      c.res.headers.set('X-Soma-Provider-Signature', dualSign.provider.signature);
      c.res.headers.set('X-Soma-Provider-Public-Key', dualSign.provider.publicKey);
      c.res.headers.set('X-Soma-Provider-Heartbeat-Index', String(dualSign.provider.heartbeatIndex));
      if (dualSign.provider.genomeHash) {
        c.res.headers.set('X-Soma-Provider-Genome-Hash', dualSign.provider.genomeHash);
      }

      // Platform cert headers (backwards compatible — standard X-Soma-* names)
      c.res.headers.set('X-Soma-Data-Hash', dualSign.platform.dataHash);
      c.res.headers.set('X-Soma-Signature', dualSign.platform.signature);
      c.res.headers.set('X-Soma-Public-Key', dualSign.platform.publicKey);
      if (dualSign.platform.heartbeatIndex != null) {
        c.res.headers.set('X-Soma-Heartbeat-Index', String(dualSign.platform.heartbeatIndex));
      }
    } else {
      // Single-sign: birth certificate headers (from fetchData — data provenance)
      const cert = getLastBirthCertificate();
      if (cert) {
        c.res.headers.set('X-Soma-Data-Hash', cert.dataHash);
        c.res.headers.set('X-Soma-Signature', cert.signature);
        c.res.headers.set('X-Soma-Heartbeat-Index', String(cert.heartbeatIndex));
        c.res.headers.set('X-Soma-Public-Key', cert.publicKey);
      }
    }

    // Generation provenance headers (from heart.generate — model verification)
    const gen = getLastGenerationProvenance();
    if (gen) {
      c.res.headers.set('X-Soma-Model-Verified', 'true');
      c.res.headers.set('X-Soma-Token-Count', String(gen.tokenCount));
      c.res.headers.set('X-Soma-Heartbeat-Count', String(gen.heartbeats.length));
      c.res.headers.set('X-Soma-Model', gen.model);
      c.res.headers.set('X-Soma-Has-HMACs', gen.tokenHmacs.some(t => t.hmac) ? 'true' : 'false');
    }

    if (!loggedOnce) {
      logger.info('Soma provenance headers active — X-Soma-* headers attached to responses (dual-sign ready)');
      loggedOnce = true;
    }
  } catch (err) {
    logger.warn({ err }, 'Soma provenance header attachment failed — sending without headers');
  }
};
