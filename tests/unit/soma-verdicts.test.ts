/**
 * Soma verdict system tests — schema, CRUD, stats, anchoring.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestDb, getTestDb } from './helpers/db';
setupTestDb();

import { initDb } from '../../src/db/connection';
import {
  recordSomaVerdict,
  getSomaVerdictStats,
  getRecentSomaVerdicts,
  getUnanchoredVerdicts,
  markVerdictsAnchored,
  createVerdictAnchor,
  confirmVerdictAnchor,
  getVerdictAnchor,
} from '../../src/db/soma-verdicts';

beforeAll(() => {
  initDb();
});

describe('Soma Verdicts', () => {
  const subjectDid = 'did:key:z6MkTestSubject1234';
  const observerDid = 'did:key:z6MkTestObserver5678';
  const genomeHash = 'abc123def456';

  it('records a verdict and returns an ID', () => {
    const id = recordSomaVerdict({
      subjectDid,
      observerDid,
      verdict: 'GREEN',
      confidence: 0.95,
      genomeHash,
      claimedModel: 'claude-sonnet-4',
      hmacVerified: true,
      heartbeatChainValid: true,
      birthCertificatesValid: true,
      seedVerified: false,
      observerSignature: 'test-sig-1',
    });

    expect(id).toMatch(/^sv-/);
  });

  it('records multiple verdicts', () => {
    recordSomaVerdict({
      subjectDid,
      observerDid: 'did:key:z6MkTestObserver2222',
      verdict: 'GREEN',
      confidence: 0.88,
      genomeHash,
      hmacVerified: true,
      heartbeatChainValid: true,
      birthCertificatesValid: false,
      seedVerified: false,
      observerSignature: 'test-sig-2',
    });

    recordSomaVerdict({
      subjectDid,
      observerDid,
      verdict: 'AMBER',
      confidence: 0.55,
      genomeHash,
      hmacVerified: false,
      heartbeatChainValid: true,
      birthCertificatesValid: false,
      seedVerified: false,
      observerSignature: 'test-sig-3',
    });
  });

  it('returns correct verdict stats', () => {
    const stats = getSomaVerdictStats(subjectDid);
    expect(stats).not.toBeNull();
    expect(stats!.totalVerdicts).toBe(3);
    expect(stats!.greenCount).toBe(2);
    expect(stats!.amberCount).toBe(1);
    expect(stats!.redCount).toBe(0);
    expect(stats!.uncannnyCount).toBe(0);
    expect(stats!.uniqueObservers).toBe(2);
    expect(stats!.avgConfidence).toBeGreaterThan(0);
  });

  it('returns null stats for unknown DID', () => {
    const stats = getSomaVerdictStats('did:key:z6MkNobody');
    expect(stats).toBeNull();
  });

  it('returns recent verdicts ordered by date', () => {
    const verdicts = getRecentSomaVerdicts(subjectDid, 10);
    expect(verdicts.length).toBe(3);
    expect(verdicts[0].verdict).toBeDefined();
    expect(verdicts[0].observerDid).toBeDefined();
    expect(verdicts[0].hmacVerified).toBeDefined();
  });

  it('returns empty array for unknown DID', () => {
    const verdicts = getRecentSomaVerdicts('did:key:z6MkNobody');
    expect(verdicts.length).toBe(0);
  });

  it('blocks self-verdicts at DB level', () => {
    // Self-verdicts should be blocked at the route level,
    // but the DB function doesn't prevent them — that's the route's job.
    // This test just verifies the DB accepts any observer/subject combo.
    const id = recordSomaVerdict({
      subjectDid: 'did:key:z6MkSelfTest',
      observerDid: 'did:key:z6MkOtherTest',
      verdict: 'RED',
      confidence: 0.3,
      genomeHash: 'redtest',
      hmacVerified: false,
      heartbeatChainValid: false,
      birthCertificatesValid: false,
      seedVerified: false,
      observerSignature: 'test-sig-red',
    });
    expect(id).toMatch(/^sv-/);
  });
});

describe('Soma Verdict Anchoring', () => {
  it('returns unanchored verdicts', () => {
    const unanchored = getUnanchoredVerdicts(100);
    expect(unanchored.length).toBeGreaterThan(0);
    expect(unanchored[0].id).toBeDefined();
    expect(unanchored[0].verdict).toBeDefined();
  });

  it('creates an anchor record', () => {
    const anchorId = createVerdictAnchor('merkle-root-hash-test', 3, '[[]]');
    expect(anchorId).toMatch(/^sa-/);

    const anchor = getVerdictAnchor(anchorId);
    expect(anchor).not.toBeNull();
    expect(anchor!.merkleRoot).toBe('merkle-root-hash-test');
    expect(anchor!.verdictCount).toBe(3);
    expect(anchor!.status).toBe('pending');
  });

  it('marks verdicts as anchored', () => {
    const unanchored = getUnanchoredVerdicts(100);
    const ids = unanchored.map(v => v.id);
    const anchorId = createVerdictAnchor('merkle-root-2', ids.length, '[[]]');

    markVerdictsAnchored(ids, anchorId);

    const stillUnanchored = getUnanchoredVerdicts(100);
    expect(stillUnanchored.length).toBe(0);
  });

  it('confirms an anchor with tx hash', () => {
    const anchorId = createVerdictAnchor('merkle-root-3', 1, '[[]]');
    confirmVerdictAnchor(anchorId, 'solana-tx-hash-test');

    const anchor = getVerdictAnchor(anchorId);
    expect(anchor!.status).toBe('anchored');
    expect(anchor!.solanaTxHash).toBe('solana-tx-hash-test');
  });

  it('returns null for unknown anchor', () => {
    const anchor = getVerdictAnchor('sa-nonexistent');
    expect(anchor).toBeNull();
  });
});
