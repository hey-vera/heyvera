# Dual-Brain Orchestrator

This project uses dual-provider orchestration. Config: `.claude/orchestrator.json`.

## Tier Routing

Route subagents by task complexity:

- **Search** (`model: "haiku"`): Read-only lookups, grep, explore. Return: files found, line refs, confidence.
- **Execute** (`model: "sonnet"`): Edits, tests, git ops. Return: files changed, tests run, edge cases.
- **Think** (main session, Opus): Architecture, review, planning. Return: decision, alternatives, risks.

## GPT Lane

For isolated or parallel work, dispatch to GPT via Codex CLI:

- `node .claude/hooks/gpt-work-dispatcher.mjs --task "..." --model gpt-5.4` — execution tasks
- `node .claude/hooks/dual-brain-think.mjs --question "..."` — dual-perspective decisions

## Routing Rules

1. Tasks under 3 min → Claude (Codex startup overhead not worth it)
2. Isolated tasks over 3 min → check balance: `node .claude/hooks/budget-balancer.mjs`
3. High-risk decisions → dual-brain think
4. When a task spans tiers: think > execute > search

## Quality Gate

Before ending a session with code changes:
1. Run `node .claude/hooks/session-report.mjs`
2. Run `node .claude/hooks/quality-gate.mjs`

Gate statuses: `pass` (safe to end), `issues_found` (fix first), `needs_human_review` (GPT unavailable).

## Profiles

Active profile controls routing posture, budgets, and quality gate behavior.
Profile persists to `.claude/dual-brain.profile.json` (gitignored).

- **balanced** (default): Best model per tier, normal budgets, reviews at medium+ risk
- **cost-saver**: Prefer cheaper models, lower budgets, skip GPT for non-critical
- **quality-first**: Dual-brain for medium+ risk, higher budgets, stricter reviews

Switch profiles: `npx dual-brain mode cost-saver`
Check status: `npx dual-brain status`

## Available Tools

- `node .claude/hooks/cost-report.mjs` — activity and cost estimates
- `node .claude/hooks/health-check.mjs` — verify system health
- `node .claude/hooks/budget-balancer.mjs` — provider balance status
- `node .claude/hooks/decision-ledger.mjs` — routing outcome insights
- `node .claude/hooks/test-orchestrator.mjs` — run self-tests
