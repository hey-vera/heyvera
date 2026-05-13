# Dual-Brain Orchestrator

Tiered model routing for Claude Code. Routes search work to Haiku, execution to Sonnet, and reserves Opus for thinking. Optionally sends diffs to GPT for independent dual-brain code review.

## Install

1. Copy the `.claude/` folder into your project root
2. Run the setup wizard: `node .claude/hooks/setup-wizard.mjs`
3. Restart your Claude Code session

The wizard asks about your subscription plans and generates `orchestrator.json` with the right models and cost rates for your tier.

## How it works

Three hookify rules in `.claude/hookify.orchestrator-*.local.md` inject system messages at key moments:

- **Route** (UserPromptSubmit): Reminds the session to delegate subagents at the right tier
- **Gate** (Stop): Catches code changes that weren't reviewed before the session ends
- **Cost** (PostToolUse on Agent): Checks that dispatched subagents use the correct model tier

A PreToolUse hook (`hooks/enforce-tier.mjs`) classifies Agent calls by keyword and advises the correct model when there's a mismatch.

## Scripts

| Script | Purpose |
|--------|---------|
| `hooks/setup-wizard.mjs` | Interactive setup — configure your subscription and preferences |
| `hooks/cost-report.mjs` | Activity & cost estimates by model tier |
| `hooks/dual-brain-review.mjs` | Send current git diff to GPT for independent review |
| `hooks/quality-gate.mjs` | Config-driven quality gate with review artifacts |
| `hooks/test-orchestrator.mjs` | Self-test harness — validates all hooks work correctly |
| `hooks/cost-logger.mjs` | PostToolUse hook that logs usage data (runs automatically) |
| `hooks/enforce-tier.mjs` | PreToolUse hook that enforces model tier routing (runs automatically) |

## Codex Skills

The `codex_skills` section in `orchestrator.json` registers CLI commands that can be invoked from any session:

- `node .claude/hooks/dual-brain-review.mjs` — GPT code review via ChatGPT subscription
- `node .claude/hooks/quality-gate.mjs` — run the quality gate (checks config, filters files, triggers review)
- `node .claude/hooks/cost-report.mjs` — session activity and cost breakdown
- `node .claude/hooks/test-orchestrator.mjs` — validate all hooks pass

## Customize

Edit `orchestrator.json` to change:
- `subscriptions` — your plans and available models per provider
- `tiers` — which task types map to which tier
- `quality_gate` — file extensions that trigger review, patterns to skip
- `routing_rules` — subagent type defaults, concurrency limits
- `codex_skills` — registered CLI skills

## Requirements

- Node 20+ (for native fetch in dual-brain-review)
- Python 3.12+ (for hookify rule engine)
- Hookify plugin installed (comes with Claude Code marketplace)
- Codex CLI installed and logged into ChatGPT (`codex login`) — for GPT dual-brain review via subscription. Falls back to `OPENAI_API_KEY` env var if Codex isn't available.
