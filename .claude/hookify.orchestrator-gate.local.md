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

**[Quality Gate]** Before ending this session:
1. Run `node .claude/hooks/session-report.mjs` to see the session summary
2. Run `node .claude/hooks/quality-gate.mjs` and check the output:
   - `gate: "pass"` — safe to end
   - `gate: "issues_found"` — address flagged issues first
   - `gate: "needs_human_review"` — GPT unavailable, review diff manually
   - `gate: "disabled"` — gate is off in config
Do NOT skip these steps.
