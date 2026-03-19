"""Thin HTTP client wrapper for ClawNet API."""

import httpx
from typing import Any, Optional


class ClawNetClient:
    """Low-level HTTP client for ClawNet API.

    Used internally by CrewAI tools. Can also be used directly for
    custom integrations.
    """

    def __init__(self, api_key: str, base_url: str = "https://claw-net.org"):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, **kwargs: Any) -> dict:
        """Make an HTTP request and return parsed JSON."""
        url = f"{self.base_url}{path}"
        with httpx.Client(timeout=60.0) as client:
            resp = client.request(method, url, headers=self.headers, **kwargs)
            if resp.status_code >= 400:
                body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                error_msg = body.get("error", resp.reason_phrase)
                code = body.get("code", "UNKNOWN")
                raise ClawNetAPIError(resp.status_code, error_msg, code)
            return resp.json()

    def orchestrate(
        self,
        query: str,
        max_credits: Optional[float] = None,
        strategy: Optional[str] = None,
    ) -> dict:
        """Query the AI orchestration engine (POST /v1/orchestrate)."""
        pricing: dict[str, Any] = {}
        if max_credits is not None:
            pricing["maxCredits"] = max_credits
        if strategy is not None:
            pricing["strategy"] = strategy
        return self._request("POST", "/v1/orchestrate", json={"query": query, "pricing": pricing})

    def invoke_skill(self, skill_id: str, variables: Optional[dict] = None) -> dict:
        """Invoke a marketplace skill (POST /v1/skills/{id}/invoke)."""
        encoded = httpx.URL(f"/{skill_id}").raw_path.decode()
        return self._request("POST", f"/v1/skills/{encoded}/invoke", json={"variables": variables or {}})

    def search(self, query: str, category: Optional[str] = None) -> dict:
        """Search endpoints and skills in parallel."""
        params: dict[str, str] = {"q": query}
        if category:
            params["category"] = category

        with httpx.Client(timeout=30.0) as client:
            endpoints_resp = client.get(
                f"{self.base_url}/v1/endpoints",
                params=params,
                headers=self.headers,
            )
            skills_resp = client.get(
                f"{self.base_url}/v1/marketplace/skills",
                params={"search": query, "limit": "10"},
                headers=self.headers,
            )

        endpoints = endpoints_resp.json().get("endpoints", []) if endpoints_resp.status_code < 400 else []
        skills = skills_resp.json().get("skills", []) if skills_resp.status_code < 400 else []

        return {"endpoints": endpoints[:10], "skills": skills[:10]}

    def get_balance(self) -> dict:
        """Get current credit balance (GET /v1/balance)."""
        return self._request("GET", "/v1/balance")


class ClawNetAPIError(Exception):
    """Raised when the ClawNet API returns an error response."""

    def __init__(self, status: int, message: str, code: str = "UNKNOWN"):
        self.status = status
        self.code = code
        super().__init__(f"ClawNet API error {status}: {message} ({code})")
