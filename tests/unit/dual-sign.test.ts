/**
 * Dual-sign wiring tests — verify that dual-sign state flows correctly
 * from the upstream-provider path into Soma receipts.
 *
 * Scenarios covered:
 *   - No dual-sign state → receipt has no provider fields
 *   - Dual-sign state set → extractDualSignReceiptFields() returns provider fields
 *   - Peek does NOT clear, get DOES clear (covers the middleware race)
 *   - create/verify roundtrip on a real platform key
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb } from '../../src/db/connection';
import {
  setLastDualSignResult,
  getLastDualSignResult,
  peekLastDualSignResult,
  extractDualSignReceiptFields,
} from '../../src/core/dual-sign-state';
import {
  createDualSign,
  verifyDualSign,
  type ProviderCertificate,
} from '../../src/core/dual-sign';
import nacl from 'tweetnacl';
import { somaHash } from '../../src/utils/crypto-agility';

// Sanity: ensure DB is initialised even though these tests don't touch it.
// signVC inside createDualSign transitively touches crypto-agility which is fine.
beforeEach(() => {
  initDb();
  // Clear any stale state leaking across tests.
  getLastDualSignResult();
});

/** Build a real provider cert signed by a generated Ed25519 keypair. */
function makeSignedProviderCert(data: string): {
  cert: ProviderCertificate;
  providerKeyPair: nacl.SignKeyPair;
} {
  const providerKeyPair = nacl.sign.keyPair();
  const dataHash = somaHash(data);
  const dataHashBytes = Buffer.from(dataHash, 'hex');
  const signature = Buffer.from(
    nacl.sign.detached(new Uint8Array(dataHashBytes), providerKeyPair.secretKey),
  ).toString('hex');
  return {
    cert: {
      protocol: 'soma/1.0',
      dataHash,
      signature,
      heartbeatIndex: 42,
      publicKey: Buffer.from(providerKeyPair.publicKey).toString('hex'),
    },
    providerKeyPair,
  };
}

describe('dual-sign state — extract helper', () => {
  it('returns empty object when no dual-sign state is set', () => {
    const fields = extractDualSignReceiptFields('prov-foo');
    expect(fields).toEqual({});
  });

  it('returns provider fields when dual-sign state is present', () => {
    const { cert } = makeSignedProviderCert('hello world');
    const dualSign = createDualSign(cert, 'hello world', 7);
    setLastDualSignResult(dualSign);

    const fields = extractDualSignReceiptFields('prov-clawapis');
    expect(fields.providerId).toBe('prov-clawapis');
    expect(fields.providerSignature).toBe(cert.signature);
    expect(fields.providerPublicKey).toBe(cert.publicKey);
    expect(fields.providerDataHash).toBe(cert.dataHash);
    expect(fields.providerHeartbeatIndex).toBe(cert.heartbeatIndex);
  });

  it('falls back to "upstream" when no providerId is given', () => {
    const { cert } = makeSignedProviderCert('x');
    setLastDualSignResult(createDualSign(cert, 'x'));
    const fields = extractDualSignReceiptFields();
    expect(fields.providerId).toBe('upstream');
  });

  it('extract does NOT clear state — middleware can still read it', () => {
    const { cert } = makeSignedProviderCert('pick me twice');
    setLastDualSignResult(createDualSign(cert, 'pick me twice'));

    // Receipt side reads it
    const first = extractDualSignReceiptFields('prov-x');
    expect(first.providerSignature).toBe(cert.signature);

    // Middleware side can still read it
    const peeked = peekLastDualSignResult();
    expect(peeked).not.toBeNull();
    expect(peeked!.provider.signature).toBe(cert.signature);
  });

  it('get clears state but peek does not', () => {
    const { cert } = makeSignedProviderCert('clear me');
    setLastDualSignResult(createDualSign(cert, 'clear me'));

    expect(peekLastDualSignResult()).not.toBeNull();
    expect(peekLastDualSignResult()).not.toBeNull(); // peek can be called twice

    const result = getLastDualSignResult();
    expect(result).not.toBeNull();
    expect(peekLastDualSignResult()).toBeNull(); // now cleared
    expect(getLastDualSignResult()).toBeNull();
  });
});

describe('dual-sign createDualSign + verifyDualSign roundtrip', () => {
  it('provider+platform both verify on a valid chain', () => {
    const responseData = JSON.stringify({ price: 100, ts: 123 });
    const { cert } = makeSignedProviderCert(responseData);
    const dualSign = createDualSign(cert, responseData, cert.heartbeatIndex);

    expect(dualSign.providerVerified).toBe(true);
    const v = verifyDualSign(dualSign);
    expect(v.provider).toBe(true);
    expect(v.platform).toBe(true);
    expect(v.chain).toBe(true);
  });

  it('tampered provider signature → providerVerified=false but chain+platform still sound', () => {
    const { cert } = makeSignedProviderCert('body');
    // Flip a byte in the signature hex
    const badSig = cert.signature.slice(0, 2) === 'ff'
      ? '00' + cert.signature.slice(2)
      : 'ff' + cert.signature.slice(2);
    const tampered: ProviderCertificate = { ...cert, signature: badSig };
    const dualSign = createDualSign(tampered, 'body');
    expect(dualSign.providerVerified).toBe(false);

    const v = verifyDualSign(dualSign);
    expect(v.provider).toBe(false);
    // Platform still signed the (bad) chain consistently → platform + chain pass
    expect(v.chain).toBe(true);
    expect(v.platform).toBe(true);
  });

  it('different responseData produces different chain hash', () => {
    const { cert: c1 } = makeSignedProviderCert('a');
    const { cert: c2 } = makeSignedProviderCert('b');
    const d1 = createDualSign(c1, 'a');
    const d2 = createDualSign(c2, 'b');
    expect(d1.chainHash).not.toBe(d2.chainHash);
  });
});
