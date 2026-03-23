"""
Deterministic trust scoring — Python port of @aidprotocol/trust-compute.

Same formula as the TypeScript version. Given identical inputs, produces
identical outputs. This is the canonical scoring library for Python agents.

CRITICAL: The proof hash MUST be byte-identical to the TypeScript version.
We implement JCS (RFC 8785) canonicalization, NOT json.dumps(sort_keys=True).
"""

import hashlib
import math
from dataclasses import dataclass
from typing import Dict, List, Any, Optional, Union


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
    formula_version: str
    hash_algorithm: str
    inputs: Dict[str, float]
    weights: Dict[str, int]


# ─── JCS (RFC 8785) Canonicalization ─────────────────────────────────────────
#
# JSON Canonicalization Scheme — deterministic JSON serialization.
# - Object keys sorted lexicographically (Unicode code point order)
# - No whitespace
# - Numbers serialized per ES2015 Number.toString() (no trailing zeros,
#   no leading zeros, exponential for very large/small)
# - Strings escaped per JSON spec
# - undefined values omitted (Python: skip None? No — null is valid in JCS)
#
# This MUST produce byte-identical output to the TypeScript jcsSerialize().


def _jcs_number(n: Union[int, float]) -> str:
    """Serialize a number per ES2015 Number.toString() rules.

    CRITICAL: Must produce byte-identical output to JavaScript's String(n).
    Key differences between Python and JS:
      - Python repr(1.0) = "1.0", JS String(1.0) = "1"
      - Python repr(-0.0) = "-0.0", JS String(-0) = "0"  (JCS spec: "0")
    """
    if isinstance(n, bool):
        raise TypeError("JCS: booleans are not numbers")
    if not math.isfinite(n):
        raise ValueError("JCS: non-finite numbers not supported")
    if isinstance(n, int):
        return str(n)
    # Handle -0.0 → "0" (JCS spec requirement)
    if n == 0.0:
        return "0"
    # ES2015 Number.toString(): shortest representation, no trailing zeros
    # Use repr() then strip trailing ".0" to match JS behavior
    s = repr(n)
    # Python repr(1.0) = "1.0" but JS String(1.0) = "1"
    if s.endswith(".0"):
        s = s[:-2]
    return s


def _jcs_string(s: str) -> str:
    """JSON-encode a string with proper escaping."""
    # Use standard JSON string escaping
    result = '"'
    for c in s:
        cp = ord(c)
        if c == '"':
            result += '\\"'
        elif c == '\\':
            result += '\\\\'
        elif c == '\b':
            result += '\\b'
        elif c == '\f':
            result += '\\f'
        elif c == '\n':
            result += '\\n'
        elif c == '\r':
            result += '\\r'
        elif c == '\t':
            result += '\\t'
        elif cp < 0x20:
            result += f'\\u{cp:04x}'
        else:
            result += c
    result += '"'
    return result


def jcs_serialize(value: Any) -> str:
    """
    RFC 8785 JSON Canonicalization Scheme.

    Produces byte-identical output to the TypeScript jcsSerialize()
    in @aidprotocol/trust-compute.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _jcs_number(value)
    if isinstance(value, str):
        return _jcs_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(jcs_serialize(item) for item in value) + "]"
    if isinstance(value, dict):
        # Keys sorted by Unicode code point order (same as Python's default sort)
        sorted_keys = sorted(value.keys())
        entries = []
        for k in sorted_keys:
            v = value[k]
            if v is not None:  # JCS omits undefined; Python None = JSON null, keep it
                entries.append(_jcs_string(str(k)) + ":" + jcs_serialize(v))
        return "{" + ",".join(entries) + "}"
    raise TypeError(f"JCS: unsupported type {type(value)}")


# ─── Constants ───────────────────────────────────────────────────────────────

FORMULA_VERSION = "1.0.0"
HASH_ALGORITHM = "sha384"

DEFAULT_WEIGHTS = {
    "successRate": 40,
    "chainCoverage": 25,
    "volume": 20,
    "manifestAdherence": 15,
}

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
    success_rate: float,
    chain_coverage: float,
    attestation_count: int,
    manifest_adherence: float,
    weights: Optional[Dict[str, int]] = None,
) -> TrustScoreResult:
    """
    Compute AID trust score using the v1.0 formula.

    This function MUST produce identical results to the TypeScript
    computeTrustScore() in @aidprotocol/trust-compute.

    Args:
        success_rate: Success count / total attestations (0-1)
        chain_coverage: Hash-chain integrity percentage (0-1)
        attestation_count: Total attestation count (raw integer)
        manifest_adherence: manifest_aligned / (aligned + unaligned) (0-1)
        weights: Optional custom weights (defaults to DEFAULT_WEIGHTS)

    Returns:
        TrustScoreResult with score, verdict, and SHA-384 proof hash
    """
    w = weights or DEFAULT_WEIGHTS

    # Normalize volume: min(attestationCount / 1000, 1)
    volume_score = min(attestation_count / 1000, 1)

    # manifestAdherence defaults to 0.5 (neutral) if no manifests checked
    manifest_score = manifest_adherence if (manifest_adherence > 0 or attestation_count > 0) else 0.5

    # Weighted sum, rounded to integer
    score = round(
        success_rate * w["successRate"] +
        chain_coverage * w["chainCoverage"] +
        min(volume_score, 1) * w["volume"] +
        manifest_score * w["manifestAdherence"]
    )

    # Clamp to 0-100
    clamped_score = max(0, min(100, score))

    # Build the proof data structure — MUST match TypeScript exactly
    # TypeScript TrustStats has: successRate, chainCoverage, attestationCount, manifestAdherence
    inputs = {
        "attestationCount": attestation_count,
        "chainCoverage": chain_coverage,
        "manifestAdherence": manifest_adherence,
        "successRate": success_rate,
    }

    proof_data = {
        "inputs": inputs,
        "score": clamped_score,
        "weights": w,
    }

    # JCS canonicalize then SHA-384 — byte-identical to TypeScript
    canonical = jcs_serialize(proof_data)
    proof_hash = hashlib.sha384(canonical.encode("utf-8")).hexdigest()

    verdict = get_trust_verdict(clamped_score)

    return TrustScoreResult(
        score=clamped_score,
        verdict=verdict.verdict,
        proof_hash=proof_hash,
        formula_version=FORMULA_VERSION,
        hash_algorithm=HASH_ALGORITHM,
        inputs=inputs,
        weights=w,
    )


def verify_trust_proof(
    score: int,
    inputs: Dict[str, Any],
    weights: Dict[str, int],
    proof_hash: str,
) -> bool:
    """
    Verify a trust score proof hash.

    Recomputes the canonical hash from inputs + weights + score
    and checks it matches the provided proof hash.
    """
    proof_data = {
        "inputs": inputs,
        "score": score,
        "weights": weights,
    }
    canonical = jcs_serialize(proof_data)
    expected = hashlib.sha384(canonical.encode("utf-8")).hexdigest()
    return expected == proof_hash
