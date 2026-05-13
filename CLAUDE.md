# ClawNet - CLAUDE.md

Claude compatibility shim.

See `AGENTS.md` for the current repo instructions and workflow rules.

## Dual-Brain Orchestrator

This workspace uses tiered model routing to optimize cost and quality. Config lives in `.claude/orchestrator.json` — edit it to match your subscription and model preferences.

| Tier | Claude Code `model:` | Use For |
|------|---------------------|---------|
| Search | `"haiku"` | Explore agents, file lookups, grep, read-only research |
| Execute | `"sonnet"` | Implementation, edits, test runs, git operations |
| Think | (main session) | Architecture, review, planning, security, complex debug |

**Decision tree — follow strictly:**

1. User asks to **find, search, grep, explore, list, read, "where is", "what files"**
   → Spawn `Explore` agent with `model: "haiku"`
2. User asks to **implement, fix, add, edit, refactor, write tests, run tests, lint, format, git ops**
   → Spawn `general-purpose` agent with `model: "sonnet"`
3. User asks to **plan, design, architect, review, audit security, debug complex issues, make decisions**
   → Handle directly on this session (Opus) or spawn `Plan` agent (inherits Opus)
4. User asks for **multiple independent tasks**
   → Spawn all agents in parallel in a single message, each at the appropriate tier
5. **Before completing any session with code changes**
   → Review the diff yourself (quality gate). If dual-brain is configured, also send to GPT for independent review via the bridge script.

**Agent output contracts — enforce these when spawning subagents:**
- **Search agents** must return: exact files/symbols, line references, confidence, what wasn't checked
- **Execute agents** must return: files changed, behavior changed, tests run + results, edge cases, assumptions
- **Think agents** must return: decision + rationale, alternatives considered, risks, verification plan

**Tier advisor:** The PreToolUse hook in `.claude/hooks/enforce-tier.mjs` checks subagent model params against the task tier and injects a correction message when mismatched. Follow its guidance. Think > execute > search when a task spans multiple tiers.

**Model routing caveat:** The `model:` parameter on Agent calls may be silently ignored in some Claude Code versions (issue #43869). If subagents all run on the parent model, set `CLAUDE_CODE_SUBAGENT_MODEL` env var as fallback.

**Model intelligence:** See `model_intelligence` in `.claude/orchestrator.json` for each model's strengths, weaknesses, and best-for guidance. Use this to pick the right tier — not just the cheapest one.

**Dual-brain review:** Run `node .claude/hooks/dual-brain-review.mjs` to send your diff to GPT-5.5 for independent review. Uses your ChatGPT subscription via Codex CLI (no API key needed). Falls back to `OPENAI_API_KEY` if Codex isn't available.

**Cost tracking:** Run `node .claude/hooks/cost-report.mjs` to see session cost estimates by model tier.

**Customization:** Edit `.claude/orchestrator.json` to change tier assignments, add models, or adjust cost rates for your subscription plan. Pricing was last verified 2026-05-13.
