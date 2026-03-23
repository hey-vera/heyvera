"""
AID Protocol trust client — resolve trust scores via the AID API.

Usage:
    from aid_trust import AIDTrust

    trust = AIDTrust()
    result = trust.get_score("did:key:z6Mk...")
    print(result.trust_score, result.verdict)
"""

import time
import urllib.request
import json
from dataclasses import dataclass
from typing import Optional, Dict
from .scoring import get_trust_verdict, TrustVerdict


@dataclass
class TrustResult:
    """Trust score lookup result."""
    did: str
    trust_score: int
    verdict: str
    discount: float
    settlement_mode: str
    attestation_count: int
    cached: bool


class AIDTrust:
    """
    AID Protocol trust client.

    Resolves trust scores via the AID API with local caching.
    No dependencies beyond Python stdlib.

    Args:
        api_url: AID trust API URL (default: https://api.claw-net.org)
        cache_ttl: Cache TTL in seconds (default: 300)
        timeout: Request timeout in seconds (default: 5)
    """

    def __init__(
        self,
        api_url: str = "https://api.claw-net.org",
        cache_ttl: int = 300,
        timeout: int = 5,
    ):
        self.api_url = api_url.rstrip("/")
        self.cache_ttl = cache_ttl
        self.timeout = timeout
        self._cache: Dict[str, tuple] = {}  # did -> (TrustResult, expires_at)

    def get_score(self, did: str) -> TrustResult:
        """
        Get the AID trust score for a DID.

        Args:
            did: Agent DID (did:key:z...)

        Returns:
            TrustResult with score, verdict, discount, and attestation count
        """
        # Check cache
        if did in self._cache:
            result, expires_at = self._cache[did]
            if time.time() < expires_at:
                return TrustResult(
                    did=result.did,
                    trust_score=result.trust_score,
                    verdict=result.verdict,
                    discount=result.discount,
                    settlement_mode=result.settlement_mode,
                    attestation_count=result.attestation_count,
                    cached=True,
                )

        # Fetch from API
        try:
            url = f"{self.api_url}/v1/aid/{urllib.parse.quote(did, safe='')}/trust"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())

            score = data.get("trustScore", data.get("score", 0))
            verdict_info = get_trust_verdict(score)

            result = TrustResult(
                did=did,
                trust_score=score,
                verdict=verdict_info.verdict,
                discount=verdict_info.discount,
                settlement_mode=verdict_info.settlement_mode,
                attestation_count=data.get("attestationCount", 0),
                cached=False,
            )

            self._cache[did] = (result, time.time() + self.cache_ttl)
            return result

        except Exception:
            return TrustResult(
                did=did, trust_score=0, verdict="new",
                discount=0.0, settlement_mode="immediate",
                attestation_count=0, cached=False,
            )

    def meets_threshold(self, did: str, min_score: int) -> bool:
        """Check if an agent meets a minimum trust threshold."""
        return self.get_score(did).trust_score >= min_score

    def clear_cache(self) -> None:
        """Clear the trust cache."""
        self._cache.clear()
