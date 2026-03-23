"""
Deterministic trust scoring — Python port of @aidprotocol/trust-compute.

Same formula as the TypeScript version. Given identical inputs, produces
identical outputs. This is the canonical scoring library for Python agents.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class TrustVerdict:
    verdict: str
    discount: float
    settlement_mode: str


@dataclass
class TrustScoreResult:
    score: int
    verdict: str
    proof_hash: str
    inputs: Dict[str, float]


# ─── Trust Verdict Tiers ─────────────────────────────────────────────────────

TRUST_TIERS = [
    (90, TrustVerdict("proceed", 0.30, "deferred")),
    (80, TrustVerdict("trusted", 0.25, "batched")),
    (60, TrustVerdict("standard", 0.20, "batched")),
    (40, TrustVerdict("caution", 0.10, "standard")),
    (20, TrustVerdict("building", 0.00, "immediate")),
    (0,  TrustVerdict("new", 0.00, "immediate")),
]


def get_trust_verdict(score: int) -> TrustVerdict:
    """Get the trust verdict for a given score."""
    for min_score, verdict in TRUST_TIERS:
        if score >= min_score:
            return verdict
    return TRUST_TIERS[-1][1]


# ─── Trust Score Computation (v1.0 formula) ──────────────────────────────────

def compute_trust_score(
    success_rate: float = 0.0,
    chain_coverage: float = 0.5,
    volume: float = 0.0,
    manifest_adherence: float = 0.5,
    verification_multiplier: float = 1.0,
) -> TrustScoreResult:
    """
    Compute AID trust score using the v1.0 formula.

    Args:
        success_rate: Success count / total attestations (0-1)
        chain_coverage: Hash-chain integrity percentage (0-1)
        volume: min(attestation_count / 1000, 1) (0-1)
        manifest_adherence: manifest_aligned / (aligned + unaligned) (0-1)
        verification_multiplier: 1.0 (none), 1.1 (partial), 1.2 (full)

    Returns:
        TrustScoreResult with score, verdict, and proof hash
    """
    # Clamp inputs
    success_rate = max(0.0, min(1.0, success_rate))
    chain_coverage = max(0.0, min(1.0, chain_coverage))
    volume = max(0.0, min(1.0, volume))
    manifest_adherence = max(0.0, min(1.0, manifest_adherence))
    verification_multiplier = max(1.0, min(1.2, verification_multiplier))

    # Weighted sum (AID spec Section 4.2)
    raw_score = (
        success_rate * 40 +
        chain_coverage * 25 +
        volume * 20 +
        manifest_adherence * 15
    )

    final_score = min(100, round(raw_score * verification_multiplier))

    # Proof hash (SHA-384, deterministic)
    inputs = {
        "successRate": round(success_rate, 6),
        "chainCoverage": round(chain_coverage, 6),
        "volume": round(volume, 6),
        "manifestAdherence": round(manifest_adherence, 6),
    }

    proof_input = json.dumps(
        {"inputs": inputs, "weights": [40, 25, 20, 15], "score": final_score},
        sort_keys=True,
        separators=(",", ":"),
    )
    proof_hash = hashlib.sha384(proof_input.encode()).hexdigest()

    verdict = get_trust_verdict(final_score)

    return TrustScoreResult(
        score=final_score,
        verdict=verdict.verdict,
        proof_hash=proof_hash,
        inputs=inputs,
    )
