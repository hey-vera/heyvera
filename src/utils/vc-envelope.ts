/**
 * vc-envelope.ts — W3C Verifiable Credentials v2.0 envelope for ClawNet attestations
 *
 * Wraps attestation rows in a standards-compliant VC structure so they
 * are interoperable with the broader W3C credentials ecosystem.
 *
 * Spec: https://www.w3.org/TR/vc-data-model-2.0/
 */

import type { AttestationRow } from '../db/attestations';
import { signVC } from './ed25519-signer';

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
 * envelope with a real Ed25519 Data Integrity proof (eddsa-jcs-2022).
 *
 * The proof is computed by:
 *   1. Building the VC without the proof field
 *   2. JCS-canonicalizing it (RFC 8785)
 *   3. SHA-256 hashing the canonical form
 *   4. Ed25519-signing the hash with the platform keypair
 *
 * The signing key is deterministically derived from PLATFORM_SIGNING_SECRET,
 * so the public key in did.json always matches.
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

  // ── Ed25519 Data Integrity Proof (eddsa-jcs-2022) ───────────────────────
  // Sign the VC *without* the proof field, then attach the proof.
  // The proofValue is Ed25519(SHA-256(JCS(vc_without_proof))), base64url-encoded.
  const proofValue = signVC(vc as unknown as Record<string, unknown>);
  vc.proof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: att.created_at,
    verificationMethod: `${ISSUER_DID}#key-1`,
    proofPurpose: 'assertionMethod',
    proofValue,
  };

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
