---
name: orchestrator-cost-check
enabled: true
event: all
tool_matcher: Agent
action: warn
conditions:
  - field: tool_name
    operator: equals
    pattern: Agent
---

**[Cost]** Subagent dispatched. Verify you selected the right tier:
- `model: "haiku"` for search/exploration
- `model: "sonnet"` for execution/implementation
- No model param (inherit Opus) only for thinking tasks
