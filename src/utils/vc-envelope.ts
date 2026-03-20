/**
 * vc-envelope.ts — W3C Verifiable Credentials v2.0 envelope for ClawNet attestations
 *
 * Wraps attestation rows in a standards-compliant VC structure so they
 * are interoperable with the broader W3C credentials ecosystem.
 *
 * Spec: https://www.w3.org/TR/vc-data-model-2.0/
 */

import type { AttestationRow } from '../db/attestations';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: Record<string, unknown>;
  proof?: Record<string, unknown>;
  evidence?: Record<string, unknown>[];
}

// ─── Issuer DID ─────────────────────────────────────────────────────────────

const ISSUER_DID = 'did:web:api.claw-net.org';

// ─── Converter ──────────────────────────────────────────────────────────────

/**
 * Convert a ClawNet AttestationRow into a W3C Verifiable Credential v2.0
 * envelope.  The credential is unsigned (no `proof` block) — a full
 * Data Integrity proof can be added later when Ed25519 signing is wired in.
 */
export function attestationToVC(
  att: AttestationRow,
  baseUrl: string,
): VerifiableCredential {
  const subject: Record<string, unknown> = {
    id: `${ISSUER_DID}:agents:${att.api_key_hash}`,
    actionType: att.action_type,
    outcome: att.outcome_status,
    creditsCharged: att.credits_charged,
  };

  // Only include fields that have values (keep the VC lean)
  if (att.input_hash) subject.inputHash = `sha256:${att.input_hash}`;
  if (att.response_hash) subject.responseHash = `sha256:${att.response_hash}`;
  if (att.duration_ms !== null && att.duration_ms !== undefined) subject.durationMs = att.duration_ms;
  if (att.manifest_aligned !== null && att.manifest_aligned !== undefined) {
    subject.manifestAligned = att.manifest_aligned === 1 ? true : att.manifest_aligned === 0 ? false : null;
  }
  if (att.manifest_verdict) subject.manifestVerdict = att.manifest_verdict;
  if (att.action_endpoint) subject.actionEndpoint = att.action_endpoint;
  if (att.action_description) subject.actionDescription = att.action_description;
  if (att.sequence_number) subject.sequenceNumber = att.sequence_number;

  const vc: VerifiableCredential = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      `${baseUrl}/contexts/attestation/v1`,
    ],
    id: `${baseUrl}/v1/attest/verify/${att.id}`,
    type: ['VerifiableCredential', 'AgentActionAttestation'],
    issuer: ISSUER_DID,
    validFrom: att.created_at,
    credentialSubject: subject,
  };

  // Attach Merkle anchor evidence when available
  if (att.anchor_id) {
    vc.evidence = [{
      type: 'MerkleAnchorEvidence',
      anchorId: att.anchor_id,
      anchoredAt: att.anchored_at ?? undefined,
    }];
  }

  return vc;
}

// ─── JSON-LD Context ────────────────────────────────────────────────────────

/**
 * Returns the JSON-LD context document that defines the ClawNet
 * attestation vocabulary terms used in credentialSubject.
 */
export function getAttestationContext(): Record<string, unknown> {
  return {
    '@context': {
      '@version': 1.1,
      '@protected': true,
      clawnet: 'https://api.claw-net.org/contexts/attestation/v1#',
      AgentActionAttestation: 'clawnet:AgentActionAttestation',
      actionType: 'clawnet:actionType',
      actionEndpoint: 'clawnet:actionEndpoint',
      actionDescription: 'clawnet:actionDescription',
      inputHash: 'clawnet:inputHash',
      responseHash: 'clawnet:responseHash',
      outcome: 'clawnet:outcome',
      creditsCharged: {
        '@id': 'clawnet:creditsCharged',
        '@type': 'https://www.w3.org/2001/XMLSchema#decimal',
      },
      durationMs: {
        '@id': 'clawnet:durationMs',
        '@type': 'https://www.w3.org/2001/XMLSchema#integer',
      },
      manifestAligned: {
        '@id': 'clawnet:manifestAligned',
        '@type': 'https://www.w3.org/2001/XMLSchema#boolean',
      },
      manifestVerdict: 'clawnet:manifestVerdict',
      sequenceNumber: {
        '@id': 'clawnet:sequenceNumber',
        '@type': 'https://www.w3.org/2001/XMLSchema#integer',
      },
      MerkleAnchorEvidence: 'clawnet:MerkleAnchorEvidence',
      anchorId: 'clawnet:anchorId',
      anchoredAt: {
        '@id': 'clawnet:anchoredAt',
        '@type': 'https://www.w3.org/2001/XMLSchema#dateTime',
      },
    },
  };
}
