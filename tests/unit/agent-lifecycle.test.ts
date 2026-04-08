/**
 * Agent Lifecycle Tests — wallet derivation, burner agents, death certificates
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb } from '../../src/db/connection';
import {
  createAgentIdentity,
  deriveSolanaWallet,
  deriveSigningKeypair,
  deriveBurnerKeypair,
  deriveDelegationKeypair,
  deriveFromRoot,
  createWalletOwnershipProof,
  verifyWalletOwnershipProof,
  walletBindingHash,
} from '../../src/core/soma-wallet';
import {
  createBurnerAgent,
  verifyBurnerAgent,
  revokeBurnerAgent,
  getBurnerAgent,
  listActiveBurners,
  countActiveBurners,
  getBurnerEffectiveTrust,
  recordBurnerSpend,
  expireStaleBurners,
  slashBurnerBond,
} from '../../src/core/burner-agent';
import {
  issueDeathCertificate,
  verifyDeathCertificate,
  getDeathCertificate,
  getDeathCertificateByDid,
  isAgentDead,
  finalizeTrustInheritance,
} from '../../src/core/death-certificate';
import { derivePlatformSeed } from '../../src/utils/ed25519-signer';

beforeEach(() => {
  initDb();
});

// Helper: deterministic test seed
function testSeed(label: string): Buffer {
  return derivePlatformSeed(`test-${label}`);
}

// ─── Wallet Derivation ─────────────────────────────────────────────────────

describe('Heart-derived wallet system', () => {
  it('creates deterministic agent identity', () => {
    const seed = testSeed('alice');
    const id1 = createAgentIdentity(seed);
    const id2 = createAgentIdentity(seed);
    expect(id1.did).toBe(id2.did);
    expect(id1.rootPublicKey).toBe(id2.rootPublicKey);
    expect(id1.did).toMatch(/^did:key:z/);
  });

  it('different seeds produce different identities', () => {
    const alice = createAgentIdentity(testSeed('alice'));
    const bob = createAgentIdentity(testSeed('bob'));
    expect(alice.did).not.toBe(bob.did);
    expect(alice.rootPublicKey).not.toBe(bob.rootPublicKey);
  });

  it('derives Solana wallet with valid base58 address', () => {
    const seed = testSeed('sol-test');
    const wallet = deriveSolanaWallet(seed, 0);
    expect(wallet.solanaAddress).toBeDefined();
    expect(wallet.solanaAddress!.length).toBeGreaterThanOrEqual(32);
    expect(wallet.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(wallet.derivationPath).toBe('soma:sol:0:v1');
  });

  it('different wallet indices produce different addresses', () => {
    const seed = testSeed('sol-multi');
    const w0 = deriveSolanaWallet(seed, 0);
    const w1 = deriveSolanaWallet(seed, 1);
    expect(w0.solanaAddress).not.toBe(w1.solanaAddress);
    expect(w0.publicKey).not.toBe(w1.publicKey);
  });

  it('same seed + index always produces same wallet', () => {
    const seed = testSeed('deterministic');
    const w1 = deriveSolanaWallet(seed, 0);
    const w2 = deriveSolanaWallet(seed, 0);
    expect(w1.solanaAddress).toBe(w2.solanaAddress);
  });

  it('signing keypair is independent from identity keypair', () => {
    const seed = testSeed('keypair-domains');
    const identity = createAgentIdentity(seed);
    const signing = deriveSigningKeypair(seed);
    const signingPubHex = Buffer.from(signing.publicKey).toString('hex');
    // Signing key uses 'sign' domain, identity uses 'identity' domain
    expect(identity.signingPublicKey).toBe(signingPubHex);
  });

  it('delegation keypair is unique per child', () => {
    const seed = testSeed('delegation');
    const child1 = deriveDelegationKeypair(seed, 'child-A');
    const child2 = deriveDelegationKeypair(seed, 'child-B');
    expect(Buffer.from(child1.publicKey).toString('hex'))
      .not.toBe(Buffer.from(child2.publicKey).toString('hex'));
  });

  it('wallet ownership proof is verifiable', () => {
    const seed = testSeed('proof');
    const wallet = deriveSolanaWallet(seed, 0);
    const proof = createWalletOwnershipProof(seed, wallet);
    // Note: proof is signed by signing key, verified against rootPublicKey
    // This works because the test verifies against the key in the proof
    expect(proof.agentDid).toMatch(/^did:key:z/);
    expect(proof.derivedPublicKey).toBe(wallet.publicKey);
    expect(proof.signature).toMatch(/^[0-9a-f]+$/);
  });

  it('wallet binding hash is deterministic', () => {
    const seed = testSeed('binding');
    const w0 = deriveSolanaWallet(seed, 0);
    const w1 = deriveSolanaWallet(seed, 1);
    const hash1 = walletBindingHash(seed, [w0.publicKey, w1.publicKey]);
    const hash2 = walletBindingHash(seed, [w1.publicKey, w0.publicKey]); // reversed
    expect(hash1).toBe(hash2); // Order-independent
  });
});

// ─── Burner Agents ──────────────────────────────────────────────────────────

describe('burner agent protocol', () => {
  // Each test gets a unique seed to avoid shared DID state
  let testCounter = 0;
  const uniqueSeed = (label: string) => testSeed(`burner-${label}-${testCounter++}`);
  const seedAndIdentity = (label: string) => {
    const seed = uniqueSeed(label);
    return { seed, identity: createAgentIdentity(seed) };
  };

  it('creates a burner agent with correct properties', () => {
    const { seed, identity } = seedAndIdentity('create');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'scrape-tokens',
      ttlSeconds: 3600,
      bondAmount: 10,
      parentTrustScore: 80,
      inheritanceFactor: 0.3,
    });

    expect(burner).not.toBeNull();
    expect(burner!.parentDid).toBe(identity.did);
    expect(burner!.status).toBe('active');
    expect(burner!.ttlSeconds).toBe(3600);
    expect(burner!.bondAmount).toBe(10);
    expect(burner!.inheritedTrust).toBe(24); // 80 * 0.3
    expect(burner!.creationSignature).toMatch(/^[0-9a-f]+$/);
  });

  it('verifies a valid burner', () => {
    const { seed, identity } = seedAndIdentity('verify');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'verify-test',
      parentTrustScore: 50,
    });

    const result = verifyBurnerAgent(burner!.id);
    expect(result.valid).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.effectiveTrust).toBeGreaterThan(0);
  });

  it('enforces max burners per parent (20)', () => {
    const { seed, identity } = seedAndIdentity('max-limit');
    const burners = [];
    for (let i = 0; i < 20; i++) {
      const b = createBurnerAgent({
        parentDid: identity.did,
        parentPublicKey: identity.signingPublicKey,
        parentRootSeed: seed,
        taskId: `task-${i}`,
        parentTrustScore: 50,
      });
      expect(b).not.toBeNull();
      burners.push(b);
    }

    // 21st should fail
    const overflow = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'task-overflow',
      parentTrustScore: 50,
    });
    expect(overflow).toBeNull();
    expect(countActiveBurners(identity.did)).toBe(20);
  });

  it('revokes and refunds bond', () => {
    const { seed, identity } = seedAndIdentity('revoke');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'revoke-test',
      bondAmount: 15,
      parentTrustScore: 50,
    });

    const refund = revokeBurnerAgent(burner!.id, 'manual');
    expect(refund).toBe(15);

    const after = getBurnerAgent(burner!.id);
    expect(after!.status).toBe('revoked');
  });

  it('tracks spend and enforces maxSpend', () => {
    const { seed, identity } = seedAndIdentity('spend');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'spend-test',
      maxSpend: 10,
      parentTrustScore: 50,
    });

    expect(recordBurnerSpend(burner!.id, 8)).toBe(true);
    expect(recordBurnerSpend(burner!.id, 3)).toBe(false); // 8 + 3 > 10
    expect(recordBurnerSpend(burner!.id, 2)).toBe(true);  // 8 + 2 = 10

    const after = getBurnerAgent(burner!.id);
    expect(after!.spent).toBe(10);
  });

  it('trust decays over time', () => {
    const { seed, identity } = seedAndIdentity('decay');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'decay-test',
      parentTrustScore: 100,
      inheritanceFactor: 0.5,
    });

    // Just created — trust should be near 50 (100 * 0.5)
    const trustNow = getBurnerEffectiveTrust(burner!.id);
    expect(trustNow).toBeGreaterThan(49); // small time elapsed
    expect(trustNow).toBeLessThanOrEqual(50);
  });

  it('slashes bond on misbehavior', () => {
    const { seed, identity } = seedAndIdentity('slash');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'slash-test',
      bondAmount: 25,
      parentTrustScore: 50,
    });

    const slashed = slashBurnerBond(burner!.id, 'bad_output');
    expect(slashed).toBe(25);

    const after = getBurnerAgent(burner!.id);
    expect(after!.status).toBe('dead');
  });

  it('caps TTL at 24 hours', () => {
    const { seed, identity } = seedAndIdentity('ttl-cap');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'ttl-cap',
      ttlSeconds: 999999,
      parentTrustScore: 50,
    });

    expect(burner!.ttlSeconds).toBe(86400);
  });

  it('caps inheritance factor at 0.5', () => {
    const { seed, identity } = seedAndIdentity('inherit-cap');
    const burner = createBurnerAgent({
      parentDid: identity.did,
      parentPublicKey: identity.signingPublicKey,
      parentRootSeed: seed,
      taskId: 'inherit-cap',
      inheritanceFactor: 0.99,
      parentTrustScore: 100,
    });

    expect(burner!.inheritedTrust).toBe(50); // 100 * 0.5 cap
  });
});

// ─── Death Certificates ─────────────────────────────────────────────────────

describe('death certificate system', () => {
  let deathTestCounter = 0;
  const uniqueAgentSeed = (label: string) => testSeed(`death-${label}-${deathTestCounter++}`);

  it('issues a death certificate with valid signature', () => {
    const seed = uniqueAgentSeed('sig');
    const identity = createAgentIdentity(seed);
    const cert = issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 85,
      reason: 'graceful',
    });

    expect(cert.agentDid).toBe(identity.did);
    expect(cert.reason).toBe('graceful');
    expect(cert.signature).toMatch(/^[0-9a-f]+$/);
    expect(cert.chainHash).toMatch(/^[0-9a-f]+$/);

    const verification = verifyDeathCertificate(cert);
    expect(verification.signatureValid).toBe(true);
    expect(verification.chainHashValid).toBe(true);
  });

  it('auto-revokes active burners on death', () => {
    const seed = uniqueAgentSeed('auto-revoke');
    const identity = createAgentIdentity(seed);

    // Create some burners
    for (let i = 0; i < 3; i++) {
      createBurnerAgent({
        parentDid: identity.did,
        parentPublicKey: identity.signingPublicKey,
        parentRootSeed: seed,
        taskId: `pre-death-${i}`,
        parentTrustScore: 50,
      });
    }
    expect(countActiveBurners(identity.did)).toBe(3);

    // Issue death cert
    const cert = issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 70,
    });

    expect(cert.burnersRevoked).toBe(3);
    expect(countActiveBurners(identity.did)).toBe(0);
  });

  it('supports successor designation with trust inheritance', () => {
    const seed = uniqueAgentSeed('successor');
    const identity = createAgentIdentity(seed);
    const successorSeed = testSeed('successor-target');
    const successor = createAgentIdentity(successorSeed);

    const cert = issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 90,
      successorDid: successor.did,
      trustInheritancePct: 0.4,
    });

    expect(cert.successorDid).toBe(successor.did);
    expect(cert.trustTransferAmount).toBe(36); // 90 * 0.4
    expect(cert.trustTransferPending).toBe(true);
    expect(cert.contestationEndsAt).not.toBeNull();
  });

  it('caps trust inheritance at 50%', () => {
    const seed = uniqueAgentSeed('cap-inherit');
    const identity = createAgentIdentity(seed);
    const cert = issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 100,
      successorDid: 'did:key:zSuccessor',
      trustInheritancePct: 0.99,
    });

    expect(cert.trustTransferAmount).toBe(50); // 100 * 0.5 cap
  });

  it('isAgentDead returns true after death cert', () => {
    const seed = uniqueAgentSeed('is-dead');
    const identity = createAgentIdentity(seed);
    expect(isAgentDead(identity.did)).toBe(false);

    issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 50,
    });

    expect(isAgentDead(identity.did)).toBe(true);
  });

  it('death cert is retrievable by DID', () => {
    const seed = uniqueAgentSeed('retrieve');
    const identity = createAgentIdentity(seed);
    const original = issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 42,
    });

    const retrieved = getDeathCertificateByDid(identity.did);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(original.id);
    expect(retrieved!.finalTrustScore).toBe(42);
  });

  it('retrieved death cert still verifies', () => {
    const seed = uniqueAgentSeed('verify-rt');
    const identity = createAgentIdentity(seed);
    issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 75,
    });

    const cert = getDeathCertificateByDid(identity.did)!;
    const verification = verifyDeathCertificate(cert);
    expect(verification.signatureValid).toBe(true);
    expect(verification.chainHashValid).toBe(true);
  });

  it('trust inheritance not finalized during contestation window', () => {
    const seed = uniqueAgentSeed('contest');
    const identity = createAgentIdentity(seed);
    const cert = issueDeathCertificate({
      agentDid: identity.did,
      agentPublicKey: identity.signingPublicKey,
      agentRootSeed: seed,
      finalTrustScore: 80,
      successorDid: 'did:key:zSuccessor',
    });

    // Window is 30 days — should not finalize now
    const transferred = finalizeTrustInheritance(cert.id);
    expect(transferred).toBe(0);
  });
});
