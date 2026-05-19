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

**[Tier Router]** Route work across both providers (config: `.claude/orchestrator.json`):

**Claude lane** (fast, interactive):
- Search (`model: "haiku"`): Read-only lookups, grep, explore. Agent must return: files found, line refs, confidence.
- Execute (`model: "sonnet"`): Edits, tests, git ops. Agent must return: files changed, tests run, edge cases.
- Think (main session): Architecture, review, planning. Agent must return: decision, alternatives, risks.

**GPT lane** (parallel, isolated work):
- Use `node .claude/hooks/gpt-work-dispatcher.mjs --task "..." --model gpt-5.4` for isolated execution
- Use `node .claude/hooks/dual-brain-think.mjs --question "..."` for dual-perspective decisions

**Routing:** Tasks <3min → Claude. Isolated tasks >3min → check balance first (`node .claude/hooks/budget-balancer.mjs`). High-risk → dual-brain. Think > execute > search when task spans tiers.
