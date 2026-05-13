---
name: orchestrator-quality-gate
enabled: true
event: stop
action: warn
conditions:
  - field: transcript
    operator: regex_match
    pattern: (Edit|Write|MultiEdit).+\.(ts|tsx|js|jsx|py|rs|go|java|rb|swift|kt)
---

**[Quality Gate]** Before ending this session, run `node .claude/hooks/quality-gate.mjs` and check the output:
- `gate: "pass"` — no issues, safe to end
- `gate: "issues_found"` — GPT flagged problems, review them before finishing
- `gate: "needs_human_review"` — GPT unavailable, manually review the diff before finishing
- `gate: "disabled"` — gate is turned off in config

Do NOT skip this step. If `issues_found`, address the issues or explicitly acknowledge them.
