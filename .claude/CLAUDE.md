# Dual-Brain Orchestrator

This project uses dual-provider orchestration. Config: `.claude/orchestrator.json`.

## Tier Routing

Route subagents by task complexity:

- **Search** (`model: "haiku"`): Read-only lookups, grep, explore. Return: files found, line refs, confidence.
- **Execute** (`model: "sonnet"`): Edits, tests, git ops. Return: files changed, tests run, edge cases.
- **Think** (main session, Opus): Architecture, review, planning. Return: decision, alternatives, risks.

## GPT Lane

For isolated or parallel work, dispatch to GPT via Codex CLI:

- `npx dual-brain dispatch --task "..." --model gpt-5.4` — execution tasks

## Dual-Brain Collaboration

Dual-brain is a multi-round conversation between Claude and GPT — not a single-shot dispatch.

**Think flow** (architecture decisions):
1. Round 1: `npx dual-brain think --question "..."`
   → GPT gives independent analysis
2. You analyze the same question independently
3. Round 2: `npx dual-brain think --question "..." --round 2 --claude-says "<your analysis>"`
   → GPT responds to your points: agreements, pushback, refined recommendation
4. You synthesize both rounds into a final decision

**Review flow** (code review):
1. Round 1: `npx dual-brain review`
   → GPT reviews the diff independently
2. You review the same diff independently
3. Round 2: `npx dual-brain review --round 2 --claude-review "<your findings>"`
   → GPT confirms shared findings, acknowledges misses, disputes false positives
4. You synthesize into a final review verdict

## Routing Rules

1. Tasks under 3 min → Claude (Codex startup overhead not worth it)
2. Isolated tasks over 3 min → check balance: `npx dual-brain budget`
3. High-risk decisions → dual-brain think
4. When a task spans tiers: think > execute > search

## Quality Gate

Before ending a session with code changes:
1. Run `npx dual-brain report`
2. Run `npx dual-brain gate`

Gate statuses: `pass` (safe to end), `issues_found` (fix first), `needs_human_review` (GPT unavailable).

## Profiles

Active profile controls routing posture, budgets, and quality gate behavior.
Profile persists to `.claude/dual-brain.profile.json` (gitignored).

- **auto** (default): Adapts routing based on task risk, provider health, and outcomes. Uses file-path risk classification and failure-loop detection to auto-escalate when needed.
- **balanced**: Best model per tier, normal budgets, reviews at medium+ risk
- **cost-saver**: Prefer cheaper models, lower budgets, skip GPT for non-critical
- **quality-first**: Dual-brain for medium+ risk, higher budgets, stricter reviews

Switch profiles: `npx dual-brain mode cost-saver`
Check status: `npx dual-brain status`

Natural language aliases work everywhere: "go aggressive", "be careful", "cheap mode", "fast", "thorough", "smart". The system strips prefixes like "go"/"be"/"use" and resolves to the canonical profile name.

## Adaptive Routing (Auto Mode)

Auto mode classifies risk from file paths and adjusts routing in real-time:

- **Risk classification**: auth/secrets→critical, billing/migrations→high, tests/utils→medium, docs→low
- **Failure detection**: 2+ failures on same prompt in 2 hours → auto-escalate tier or trigger dual-brain. Uses time-weighted decay (recent failures count more) and ledger pruning for entries >24hrs.
- **Provider balance**: Routes to underused provider when one subscription is hot
- **Burst awareness**: Suppresses duplicate warnings and balance hints during agent waves (3+ agents in 90s)

## Vibe Coding

Casual natural language → structured work. The vibe coding system translates informal requests into properly routed, risk-classified, quality-gated work.

**Intent compiler** — decompose multi-task requests:
```bash
npx dual-brain vibe "fix the login bug and also update the nav"
```
Returns structured tasks with tier/risk classification, complexity level, quality gates, and wave strategy.

**Plan generator** — Steve-style 3-part markdown plans:
```bash
npx dual-brain plan --utterance "..." [--write]
```
Generates: (1) dependency-ordered task table, (2) user stories + edge cases, (3) questions with suggested answers. Pass `--write` to save to `.claude/plans/`.

**Durable memory** — preferences persist across sessions:
```bash
npx dual-brain memory                              # show state
npx dual-brain memory --set preferences.risk_tolerance=careful
npx dual-brain memory --threads                    # active work
npx dual-brain memory --infer                      # preference suggestions
```
Tracks preferred profile, risk tolerance, active threads, and learns from usage patterns.

## Available Tools

All commands available via `npx dual-brain <command>`:

- `npx dual-brain vibe "..."` — decompose casual requests into structured work
- `npx dual-brain plan --utterance "..."` — generate execution plans
- `npx dual-brain memory` — persistent preferences and work threads
- `npx dual-brain cost` — activity and cost estimates
- `npx dual-brain health` — verify system health
- `npx dual-brain budget` — provider balance status
- `npx dual-brain ledger` — routing outcome insights
- `npx dual-brain think --question "..."` — dual-brain think collaboration
- `npx dual-brain review` — dual-brain code review
- `npx dual-brain dispatch --task "..."` — dispatch work to GPT
- `npx dual-brain report` — generate session report
- `npx dual-brain gate` — run quality gate
- `npx dual-brain test` — run self-tests
