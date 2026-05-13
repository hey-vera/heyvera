# Dual-Brain Orchestrator

Dual-provider orchestration for Claude Code across Claude ($100 Max) and OpenAI ($100 Pro) subscriptions. Routes search work to Haiku, execution to Sonnet, and reserves Opus for thinking on the Claude lane. Dispatches isolated and long-running tasks to GPT via Codex CLI, with dual-brain analysis for high-risk decisions.

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
| `hooks/install-git-hooks.mjs` | Install a git pre-commit hook that enforces the quality gate at commit time |
| `hooks/health-check.mjs` | Verify all hooks and dependencies are configured and reachable |
| `hooks/session-report.mjs` | Comprehensive session-end summary: activity, routing compliance, quality gate, data quality, drift warnings |
| `hooks/budget-balancer.mjs` | Show provider balance and routing recommendations |
| `hooks/gpt-work-dispatcher.mjs` | Dispatch execution tasks to GPT via Codex CLI |
| `hooks/dual-brain-think.mjs` | Dual-perspective analysis on architecture decisions |

## Codex Skills

The `codex_skills` section in `orchestrator.json` registers CLI commands that can be invoked from any session:

- `node .claude/hooks/dual-brain-review.mjs` — GPT code review via ChatGPT subscription
- `node .claude/hooks/quality-gate.mjs` — run the quality gate (checks config, filters files, triggers review)
- `node .claude/hooks/cost-report.mjs` — session activity and cost breakdown
- `node .claude/hooks/test-orchestrator.mjs` — validate all hooks pass
- `node .claude/hooks/session-report.mjs` — comprehensive session-end summary report

## Model Intelligence

The `model_intelligence` section in `orchestrator.json` provides per-model metadata:

- **strengths/weaknesses** — what each model is good and bad at
- **best_for/avoid_for** — task guidance for the tier router
- **context_window/max_output** — token limits per model
- **codex_compatible** — whether the model works with `codex exec`

The `enforce-tier.mjs` hook reads this data to give context-aware routing advice.

### Known Issues

- The `model:` parameter on Agent calls may be silently ignored in some Claude Code versions ([#43869](https://github.com/anthropics/claude-code/issues/43869)). Set `CLAUDE_CODE_SUBAGENT_MODEL` as env var fallback.
- Opus 4.7 uses a new tokenizer that consumes 12-35% more tokens for the same text. Factor this into cost estimates.
- Pricing was last verified 2026-05-13. Run the setup wizard to update rates.

## Customize

Edit `orchestrator.json` to change:
- `subscriptions` — your plans and available models per provider
- `tiers` — which task types map to which tier
- `quality_gate` — file extensions that trigger review, patterns to skip
- `routing_rules` — subagent type defaults, concurrency limits
- `codex_skills` — registered CLI skills
- `review-rules.md` — project-specific rules injected into GPT review prompts

## Requirements

- Node 20+ (for native fetch in dual-brain-review)
- Python 3.12+ (optional, for hookify rule engine)
- Hookify plugin installed (comes with Claude Code marketplace)
- Codex CLI installed and logged into ChatGPT (`codex login`) — for GPT dual-brain review via subscription. Falls back to `OPENAI_API_KEY` env var if Codex isn't available.
