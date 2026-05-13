---
name: orchestrator-routing
enabled: true
event: prompt
action: warn
conditions:
  - field: user_prompt
    operator: regex_match
    pattern: .+
---

**[Tier Router]** Route subagents by tier (config: `.claude/orchestrator.json`):

**Search** (`model: "haiku"`): Read-only lookups, grep, explore, file reads.
  → Agent must return: exact files/symbols found, line references, confidence level, what was not checked.

**Execute** (`model: "sonnet"`): Implementation, edits, tests, git ops, refactoring.
  → Agent must return: files changed, behavior changed, tests run + results, edge cases considered, assumptions made.

**Think** (main session): Architecture, review, planning, security, complex debug.
  → Agent must return: decision with rationale, alternatives considered, risks identified, verification plan.

Spawn independent agents in parallel. Think > execute > search when task spans multiple tiers.
