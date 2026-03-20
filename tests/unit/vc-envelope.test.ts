/**
 * Unit tests — W3C Verifiable Credentials v2.0 envelope
 *
 * Tests the VC envelope functions that wrap attestation rows in
 * standards-compliant W3C VC structures for interoperability.
 */
import { describe, expect, it } from 'vitest';
import { attestationToVC, getAttestationContext } from '../../src/utils/vc-envelope';
import type { AttestationRow } from '../../src/db/attestations';

const BASE_URL = 'https://api.claw-net.org';

/** Minimal valid attestation row for testing */
function makeAttestation(overrides: Partial<AttestationRow> = {}): AttestationRow {
  return {
    id: 'att-001',
    api_key_hash: 'abc123def456',
    sequence_number: 1,
    attestation_type: 'action',
    manifest_id: null,
    manifest_verdict: null,
    manifest_confidence: null,
    manifest_aligned: null,
    action_type: 'api_call',
    action_endpoint: '/v1/orchestrate',
    action_description: 'Orchestrate a query',
    input_hash: 'a'.repeat(64),
    response_hash: 'b'.repeat(64),
    source_hashes_json: null,
    credits_charged: 2.5,
    duration_ms: 150,
    outcome_status: 'success',
    outcome_data_json: null,
    signature: null,
    signed_at: null,
    created_at: '2026-03-20T12:00:00.000Z',
    anchor_id: null,
    anchored_at: null,
    ...overrides,
  };
}

// ─── attestationToVC structure ───────────────────────────────────────────────

describe('attestationToVC', () => {
  it('produces valid W3C VC 2.0 structure', () => {
    const att = makeAttestation();
    const vc = attestationToVC(att, BASE_URL);

    expect(vc).toBeDefined();
    expect(typeof vc).toBe('object');
    // Must have all required top-level fields
    expect(vc['@context']).toBeDefined();
    expect(vc.id).toBeDefined();
    expect(vc.type).toBeDefined();
    expect(vc.issuer).toBeDefined();
    expect(vc.validFrom).toBeDefined();
    expect(vc.credentialSubject).toBeDefined();
  });

  it('has correct @context array', () => {
    const vc = attestationToVC(makeAttestation(), BASE_URL);
    expect(vc['@context']).toBeInstanceOf(Array);
    expect(vc['@context']).toContain('https://www.w3.org/ns/credentials/v2');
    expect(vc['@context'][1]).toBe(`${BASE_URL}/contexts/attestation/v1`);
  });

  it('has correct type array', () => {
    const vc = attestationToVC(makeAttestation(), BASE_URL);
    expect(vc.type).toEqual(['VerifiableCredential', 'AgentActionAttestation']);
  });

  it('id is a resolvable URL based on attestation id', () => {
    const vc = attestationToVC(makeAttestation({ id: 'att-xyz' }), BASE_URL);
    expect(vc.id).toBe(`${BASE_URL}/v1/attest/verify/att-xyz`);
  });

  it('issuer is did:web format', () => {
    const vc = attestationToVC(makeAttestation(), BASE_URL);
    expect(vc.issuer).toMatch(/^did:web:/);
    expect(vc.issuer).toBe('did:web:api.claw-net.org');
  });

  it('validFrom matches attestation created_at', () => {
    const ts = '2026-03-20T15:30:00.000Z';
    const vc = attestationToVC(makeAttestation({ created_at: ts }), BASE_URL);
    expect(vc.validFrom).toBe(ts);
  });

  it('credentialSubject has expected core fields', () => {
    const att = makeAttestation();
    const vc = attestationToVC(att, BASE_URL);
    const subject = vc.credentialSubject;

    expect(subject.id).toContain(att.api_key_hash);
    expect(subject.actionType).toBe('api_call');
    expect(subject.outcome).toBe('success');
    expect(subject.creditsCharged).toBe(2.5);
  });

  it('credentialSubject.id is a DID-based identifier', () => {
    const vc = attestationToVC(makeAttestation({ api_key_hash: 'mykeyhash' }), BASE_URL);
    expect(vc.credentialSubject.id).toBe('did:web:api.claw-net.org:agents:mykeyhash');
  });

  it('hashes are sha256-prefixed in credentialSubject', () => {
    const att = makeAttestation({
      input_hash: 'a'.repeat(64),
      response_hash: 'b'.repeat(64),
    });
    const vc = attestationToVC(att, BASE_URL);
    expect(vc.credentialSubject.inputHash).toBe(`sha256:${'a'.repeat(64)}`);
    expect(vc.credentialSubject.responseHash).toBe(`sha256:${'b'.repeat(64)}`);
  });

  it('includes optional fields when present', () => {
    const att = makeAttestation({
      duration_ms: 250,
      manifest_aligned: 1,
      manifest_verdict: 'compliant',
      action_endpoint: '/v1/skills/invoke',
      action_description: 'Invoke a skill',
      sequence_number: 42,
    });
    const vc = attestationToVC(att, BASE_URL);
    const subject = vc.credentialSubject;

    expect(subject.durationMs).toBe(250);
    expect(subject.manifestAligned).toBe(true);
    expect(subject.manifestVerdict).toBe('compliant');
    expect(subject.actionEndpoint).toBe('/v1/skills/invoke');
    expect(subject.actionDescription).toBe('Invoke a skill');
    expect(subject.sequenceNumber).toBe(42);
  });

  it('manifestAligned false when value is 0', () => {
    const vc = attestationToVC(makeAttestation({ manifest_aligned: 0 }), BASE_URL);
    expect(vc.credentialSubject.manifestAligned).toBe(false);
  });

  it('omits optional fields when null', () => {
    const att = makeAttestation({
      input_hash: '', // falsy
      response_hash: null,
      duration_ms: null,
      manifest_aligned: null,
      manifest_verdict: null,
      action_endpoint: null,
      action_description: null,
      sequence_number: 0, // falsy
    });
    const vc = attestationToVC(att, BASE_URL);
    const subject = vc.credentialSubject;

    expect(subject.responseHash).toBeUndefined();
    expect(subject.durationMs).toBeUndefined();
    expect(subject.manifestAligned).toBeUndefined();
    expect(subject.manifestVerdict).toBeUndefined();
    expect(subject.actionEndpoint).toBeUndefined();
    expect(subject.actionDescription).toBeUndefined();
  });
});

// ─── Evidence (Merkle anchor) ────────────────────────────────────────────────

describe('attestationToVC evidence', () => {
  it('includes evidence when anchor_id is present', () => {
    const att = makeAttestation({
      anchor_id: 'anchor-abc',
      anchored_at: '2026-03-20T13:00:00.000Z',
    });
    const vc = attestationToVC(att, BASE_URL);

    expect(vc.evidence).toBeDefined();
    expect(vc.evidence).toHaveLength(1);
    expect(vc.evidence![0].type).toBe('MerkleAnchorEvidence');
    expect(vc.evidence![0].anchorId).toBe('anchor-abc');
    expect(vc.evidence![0].anchoredAt).toBe('2026-03-20T13:00:00.000Z');
  });

  it('omits evidence when no anchor_id', () => {
    const att = makeAttestation({ anchor_id: null, anchored_at: null });
    const vc = attestationToVC(att, BASE_URL);
    expect(vc.evidence).toBeUndefined();
  });

  it('evidence anchoredAt is undefined when anchored_at is null', () => {
    const att = makeAttestation({ anchor_id: 'anchor-123', anchored_at: null });
    const vc = attestationToVC(att, BASE_URL);
    expect(vc.evidence).toBeDefined();
    expect(vc.evidence![0].anchoredAt).toBeUndefined();
  });
});

// ─── getAttestationContext ───────────────────────────────────────────────────

describe('getAttestationContext', () => {
  it('returns valid JSON-LD context object', () => {
    const ctx = getAttestationContext();
    expect(ctx).toBeDefined();
    expect(ctx['@context']).toBeDefined();
  });

  it('context has @version and @protected', () => {
    const ctx = getAttestationContext()['@context'] as Record<string, unknown>;
    expect(ctx['@version']).toBe(1.1);
    expect(ctx['@protected']).toBe(true);
  });

  it('context defines ClawNet vocabulary namespace', () => {
    const ctx = getAttestationContext()['@context'] as Record<string, unknown>;
    expect(ctx.clawnet).toBe('https://api.claw-net.org/contexts/attestation/v1#');
  });

  it('context includes all attestation terms', () => {
    const ctx = getAttestationContext()['@context'] as Record<string, unknown>;
    const expectedTerms = [
      'AgentActionAttestation',
      'actionType',
      'actionEndpoint',
      'actionDescription',
      'inputHash',
      'responseHash',
      'outcome',
      'creditsCharged',
      'durationMs',
      'manifestAligned',
      'manifestVerdict',
      'sequenceNumber',
      'MerkleAnchorEvidence',
      'anchorId',
      'anchoredAt',
    ];
    for (const term of expectedTerms) {
      expect(ctx[term]).toBeDefined();
    }
  });

  it('typed properties have correct XSD types', () => {
    const ctx = getAttestationContext()['@context'] as Record<string, unknown>;

    const decimal = ctx.creditsCharged as Record<string, string>;
    expect(decimal['@type']).toContain('decimal');

    const integer = ctx.durationMs as Record<string, string>;
    expect(integer['@type']).toContain('integer');

    const bool = ctx.manifestAligned as Record<string, string>;
    expect(bool['@type']).toContain('boolean');

    const dateTime = ctx.anchoredAt as Record<string, string>;
    expect(dateTime['@type']).toContain('dateTime');
  });
});
