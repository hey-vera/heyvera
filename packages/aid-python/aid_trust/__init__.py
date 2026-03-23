"""
AID Protocol Trust Scoring for Python

Deterministic trust scoring for AI agents. Byte-identical output
to the TypeScript @aidprotocol/trust-compute library.

Usage:
    from aid_trust import AIDTrust, compute_trust_score

    # API client
    trust = AIDTrust()
    result = trust.get_score("did:key:z6Mk...")
    print(result.trust_score, result.verdict)

    # Local computation (no network)
    score = compute_trust_score(
        success_rate=0.95,
        chain_coverage=0.8,
        attestation_count=500,
        manifest_adherence=0.9,
    )
    print(score.score, score.proof_hash)

CrewAI integration:
    from aid_trust.crewai import TrustFilter

    researcher = Agent(
        role="researcher",
        hiring_filter=TrustFilter(min_score=60)
    )
"""

from .client import AIDTrust, TrustResult
from .scoring import (
    compute_trust_score,
    get_trust_verdict,
    verify_trust_proof,
    jcs_serialize,
    TrustVerdict,
    TrustScoreResult,
    FORMULA_VERSION,
    HASH_ALGORITHM,
    DEFAULT_WEIGHTS,
)

__version__ = "1.0.0"
__all__ = [
    "AIDTrust",
    "TrustResult",
    "compute_trust_score",
    "get_trust_verdict",
    "verify_trust_proof",
    "jcs_serialize",
    "TrustVerdict",
    "TrustScoreResult",
    "FORMULA_VERSION",
    "HASH_ALGORITHM",
    "DEFAULT_WEIGHTS",
]
