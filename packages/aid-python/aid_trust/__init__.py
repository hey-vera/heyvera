"""
AID Protocol Trust Scoring for Python

Trust-scored agent commerce for CrewAI, LangGraph, and AutoGen.

Usage:
    from aid_trust import AIDTrust

    trust = AIDTrust()
    score = trust.get_score("did:key:z6Mk...")
    print(score.trust_score)  # 87
    print(score.verdict)      # "trusted"

CrewAI integration:
    from aid_trust.crewai import TrustFilter

    researcher = Agent(
        role="researcher",
        hiring_filter=TrustFilter(min_score=60)
    )
"""

from .client import AIDTrust, TrustResult, TrustVerdict
from .scoring import compute_trust_score, get_trust_verdict

__version__ = "1.0.0"
__all__ = ["AIDTrust", "TrustResult", "TrustVerdict", "compute_trust_score", "get_trust_verdict"]
