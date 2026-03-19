"""CrewAI tools for ClawNet — orchestration, skills, and search."""

import json
from typing import Any, Optional, Type

from crewai_tools import BaseTool
from pydantic import BaseModel, Field

from .client import ClawNetClient


# ─── Input schemas ────────────────────────────────────────────────────────────


class OrchestrateInput(BaseModel):
    """Input for the ClawNet orchestration tool."""

    query: str = Field(
        description='The question or task to orchestrate (e.g., "What is the price of SOL?", "Find leads at fintech companies in NYC")'
    )
    max_credits: Optional[float] = Field(
        default=None,
        description="Maximum credits to spend. Returns 402 if the plan exceeds budget.",
    )
    strategy: Optional[str] = Field(
        default=None,
        description="Optimization strategy: cheapest, balanced, fastest, or reliable. Default: balanced.",
    )


class SkillInput(BaseModel):
    """Input for the ClawNet skill invocation tool."""

    skill_id: str = Field(
        description='The skill ID to invoke (e.g., "vie-crypto-trust", "context-engine")'
    )
    variables: Optional[dict[str, str]] = Field(
        default=None,
        description='Template variables for the skill (e.g., {"token": "SOL", "depth": "standard"})',
    )


class SearchInput(BaseModel):
    """Input for the ClawNet search tool."""

    query: str = Field(
        description='What capability you need (e.g., "token price data", "lead enrichment", "sentiment analysis")'
    )
    category: Optional[str] = Field(
        default=None,
        description="Optional category filter: solana, social, defi, scraping, search, media, enrichment, security, ai-ml, infrastructure, weather, oracle, discovery",
    )


# ─── Tools ────────────────────────────────────────────────────────────────────


class ClawNetOrchestrateTool(BaseTool):
    """Query ClawNet's AI orchestration engine with 390+ live APIs."""

    name: str = "clawnet_orchestrate"
    description: str = (
        "Query ClawNet's AI orchestration engine. Automatically selects from 390+ APIs, "
        "executes multi-step workflows, and returns a formatted answer. Supports pricing "
        "strategies: cheapest, balanced, fastest, reliable. Costs credits per query."
    )
    args_schema: Type[BaseModel] = OrchestrateInput

    api_key: str = Field(description="ClawNet API key (cn-...)")
    base_url: str = Field(default="https://claw-net.org", description="ClawNet API base URL")

    def _run(self, query: str, max_credits: Optional[float] = None, strategy: Optional[str] = None) -> str:
        try:
            client = ClawNetClient(self.api_key, self.base_url)
            result = client.orchestrate(query, max_credits=max_credits, strategy=strategy)
            return json.dumps(
                {
                    "answer": result.get("answer"),
                    "stepsExecuted": len(result.get("steps", [])),
                    "creditsUsed": result.get("metadata", {}).get("totalCredits"),
                    "durationMs": result.get("metadata", {}).get("durationMs"),
                }
            )
        except Exception as e:
            return f"Error: {e}"


class ClawNetSkillTool(BaseTool):
    """Invoke a specific ClawNet marketplace skill by ID."""

    name: str = "clawnet_invoke_skill"
    description: str = (
        "Invoke a specific ClawNet marketplace skill by ID. Skills are pre-built AI capabilities "
        "(crypto analysis, data enrichment, security scanning, etc.). Pass template variables as "
        "key-value pairs. Use clawnet_search first to find the right skill ID."
    )
    args_schema: Type[BaseModel] = SkillInput

    api_key: str = Field(description="ClawNet API key (cn-...)")
    base_url: str = Field(default="https://claw-net.org", description="ClawNet API base URL")

    def _run(self, skill_id: str, variables: Optional[dict[str, str]] = None) -> str:
        try:
            client = ClawNetClient(self.api_key, self.base_url)
            result = client.invoke_skill(skill_id, variables=variables)
            return json.dumps(
                {
                    "answer": result.get("answer") or result.get("result") or result.get("data"),
                    "creditCost": result.get("creditCost"),
                    **({"metadata": result["metadata"]} if "metadata" in result else {}),
                }
            )
        except Exception as e:
            return f"Error: {e}"


class ClawNetSearchTool(BaseTool):
    """Search ClawNet's API endpoint registry and skill marketplace."""

    name: str = "clawnet_search"
    description: str = (
        "Search ClawNet's API endpoint registry and skill marketplace. Find capabilities "
        "by keyword (e.g., 'crypto price', 'email finder', 'web scraping'). Returns matching "
        "endpoints and skills with IDs, descriptions, and pricing. Free — no credits charged."
    )
    args_schema: Type[BaseModel] = SearchInput

    api_key: str = Field(description="ClawNet API key (cn-...)")
    base_url: str = Field(default="https://claw-net.org", description="ClawNet API base URL")

    def _run(self, query: str, category: Optional[str] = None) -> str:
        try:
            client = ClawNetClient(self.api_key, self.base_url)
            result = client.search(query, category=category)
            return json.dumps(
                {
                    "endpoints": [
                        {
                            "id": e.get("id"),
                            "name": e.get("name"),
                            "provider": e.get("provider"),
                            "description": e.get("description"),
                            "costPerCall": e.get("costPerCall"),
                        }
                        for e in result.get("endpoints", [])
                    ],
                    "skills": [
                        {
                            "id": s.get("id"),
                            "name": s.get("name"),
                            "description": s.get("description"),
                            "creditCost": s.get("credit_cost"),
                            "tags": s.get("tags"),
                        }
                        for s in result.get("skills", [])
                    ],
                }
            )
        except Exception as e:
            return f"Error: {e}"
