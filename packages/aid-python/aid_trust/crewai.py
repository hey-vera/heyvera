"""
CrewAI integration — trust-scored agent hiring.

Usage:
    from aid_trust.crewai import TrustFilter

    researcher = Agent(
        role="researcher",
        tools=[...],
        hiring_filter=TrustFilter(min_score=60, verified=True)
    )
"""

from .client import AIDTrust


class TrustFilter:
    """
    Trust-based agent filter for CrewAI crews.

    Checks agent trust score before hiring. Rejects agents
    below the minimum trust threshold.

    Args:
        min_score: Minimum trust score (0-100, default: 40)
        verified: Require verified status (default: False)
        api_url: AID API URL (default: https://api.claw-net.org)
    """

    def __init__(
        self,
        min_score: int = 40,
        verified: bool = False,
        api_url: str = "https://api.claw-net.org",
    ):
        self.min_score = min_score
        self.verified = verified
        self.trust = AIDTrust(api_url=api_url)

    def check(self, agent_did: str) -> dict:
        """
        Check if an agent meets the trust requirements.

        Returns:
            dict with 'allowed', 'score', 'verdict', 'reason'
        """
        result = self.trust.get_score(agent_did)

        if result.trust_score < self.min_score:
            return {
                "allowed": False,
                "score": result.trust_score,
                "verdict": result.verdict,
                "reason": f"Trust score {result.trust_score} below minimum {self.min_score}",
            }

        if self.verified and result.trust_score < 40:
            return {
                "allowed": False,
                "score": result.trust_score,
                "verdict": result.verdict,
                "reason": "Agent not verified (trust score below 40)",
            }

        return {
            "allowed": True,
            "score": result.trust_score,
            "verdict": result.verdict,
            "reason": f"Trust score {result.trust_score} ({result.verdict}) — approved",
        }
