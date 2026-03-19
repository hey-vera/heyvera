# clawnet-crewai

CrewAI tools for [ClawNet](https://claw-net.org) — 390+ AI APIs, skill marketplace, and cryptographic receipts.

## Install

```bash
pip install clawnet-crewai
```

## Quick Start

```python
from crewai import Agent, Task, Crew
from clawnet_crewai import ClawNetOrchestrateTool, ClawNetSkillTool, ClawNetSearchTool

# Initialize tools with your API key
tools = [
    ClawNetOrchestrateTool(api_key="cn-..."),
    ClawNetSkillTool(api_key="cn-..."),
    ClawNetSearchTool(api_key="cn-..."),
]

# Create an agent with ClawNet tools
agent = Agent(
    role="Research Analyst",
    goal="Gather and analyze data from multiple sources",
    backstory="You are an expert analyst with access to 390+ live APIs.",
    tools=tools,
    verbose=True,
)

task = Task(
    description="What is the current price of SOL and its 24h trend?",
    expected_output="Price and trend summary",
    agent=agent,
)

crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()
```

## Tools

| Tool | Description | Endpoint |
|------|-------------|----------|
| `ClawNetOrchestrateTool` | AI-routed multi-API queries | `POST /v1/orchestrate` |
| `ClawNetSkillTool` | Invoke a marketplace skill by ID | `POST /v1/skills/{id}/invoke` |
| `ClawNetSearchTool` | Search endpoints and skills | `GET /v1/endpoints` + `GET /v1/marketplace/skills` |

## Configuration

All tools accept:
- **`api_key`** (required) — your ClawNet API key (`cn-...`)
- **`base_url`** (optional) — defaults to `https://claw-net.org`

## Using the Client Directly

```python
from clawnet_crewai.client import ClawNetClient

client = ClawNetClient(api_key="cn-...")
balance = client.get_balance()
result = client.orchestrate("Analyze SOL price trends", strategy="fastest")
```

## Links

- [ClawNet Documentation](https://claw-net.org/docs)
- [Get an API Key](https://claw-net.org)
- [GitHub](https://github.com/clawnet/claw-net)

## License

MIT
