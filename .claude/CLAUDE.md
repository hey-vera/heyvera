# Dual-Brain Orchestrator

> Extension of data-tools by Steve Moraco. Requires replit-tools for full functionality.

This project uses dual-provider orchestration. Config: `.claude/orchestrator.json`.

## Ship Captain — Primary Workflow

The preferred way to start any task:

```bash
npx dual-brain do "fix the auth bug and write tests"
```

Automatically: decomposes goal → selects agents via intent detection → executes →
runs tests → quality gate → self-heals issues (2 retries) → creates branch → opens PR.

**Flags:**
- `--yolo` — skip confirmations (still runs tests/gate, never auto-merges)
- `--careful` — confirm every step
- `--plan-only` — preview the plan without executing
- `--no-pr` — skip PR creation

**Intent detection** routes goals automatically: `fix`/`add` → execute chain, `explore`/`understand` → search-then-execute chain, `review` → dual-brain review chain.

**Resume an incomplete run:**
```bash
npx dual-brain resume
```

## Tier Routing

Route subagents by task complexity:

- **Search** (`model: "haiku"`): Read-only lookups, grep, explore. Return: files found, line refs, confidence.
- **Execute** (`model: "sonnet"`): Edits, tests, git ops. Return: files changed, tests run, edge cases.
- **Think** (main session, Opus): Architecture, review, planning. Return: decision, alternatives, risks.

The `enforce-tier` hook **blocks** severe mismatches in auto/balanced/quality-first profiles rather than just warning.

## Agent Templates

Pre-built specialist agents for common tasks:

```bash
npx dual-brain agents                    # list all templates
```

Templates include `explorer`, `fixer`, `reviewer`, `tester`, and more. Ship Captain selects the right template automatically based on intent detection.

## Agent Chains

Multi-step workflows that compose templates:

```bash
npx dual-brain chains                    # list all chains
npx dual-brain do "explore auth then fix" # auto-selects explore-then-fix chain
```

Built-in chains: `explore-then-fix`, `test-and-fix`, `review-and-apply`.

## GPT Lane

For isolated or parallel work, dispatch to GPT via Codex CLI:

- `npx dual-brain dispatch --task "..." --model gpt-5.4` — execution tasks

## Dual-Brain Collaboration

Think and review now auto-complete the full 2-round dialogue by default.

**Think flow** (architecture decisions):

```bash
npx dual-brain think --question "should we use Redis?"
# → GPT Round 1 → Claude analysis → GPT Round 2 → Synthesis
```

Use `--manual` to step through rounds yourself:
1. Round 1: `npx dual-brain think --question "..." --manual`
2. You analyze independently
3. Round 2: `npx dual-brain think --question "..." --round 2 --claude-says "<your analysis>"`
4. You synthesize both rounds into a final decision

**Review flow** (code review):

```bash
npx dual-brain review
# → GPT Round 1 → Claude review → GPT Round 2 → Final verdict
```

Use `--manual` for the old step-by-step flow.

## Routing Rules

1. Tasks under 3 min → Claude (Codex startup overhead not worth it)
2. Isolated tasks over 3 min → check balance: `npx dual-brain budget`
3. High-risk decisions → dual-brain think (auto-triggered by hooks in auto mode)
4. When a task spans tiers: think > execute > search

## Quality Gate

Before ending a session with code changes:
1. Run `npx dual-brain report`
2. Run `npx dual-brain gate`

Gate statuses: `pass` (safe to end), `issues_found` (fix first), `needs_human_review` (GPT unavailable).

**Self-healing:** When Ship Captain is running, gate issues are automatically fixed and retried up to 2 times. Test failures are also auto-fixed (2 retries) before surfacing to the user.

## Recovery

```bash
npx dual-brain doctor    # check system health and report issues
npx dual-brain repair    # fix corrupt files, stale locks, re-register hooks
npx dual-brain reset     # clear all state files (keeps config/hooks)
npx dual-brain resume    # resume last incomplete Ship Captain run
```

## Profiles

Active profile controls routing posture, budgets, and quality gate behavior.
Profile persists to `.claude/dual-brain.profile.json` (gitignored).

- **auto** (default): Adapts routing based on task risk, provider health, and outcomes. Uses file-path risk classification and failure-loop detection to auto-escalate when needed. Blocks major tier mismatches.
- **balanced**: Best model per tier, normal budgets, reviews at medium+ risk. Blocks major mismatches.
- **cost-saver**: Prefer cheaper models, lower budgets, skip GPT for non-critical. Warns on major mismatches (does not block).
- **quality-first**: Dual-brain for medium+ risk, higher budgets, stricter reviews. Blocks minor and major mismatches.

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

**Primary workflow:**
- `npx dual-brain do "..."` — Ship Captain: goal → plan → execute → gate → PR
- `npx dual-brain resume` — resume last incomplete run

**Collaboration:**
- `npx dual-brain think --question "..."` — dual-brain think (auto 2-round; `--manual` for step-by-step)
- `npx dual-brain review` — dual-brain code review (auto 2-round; `--manual` for step-by-step)
- `npx dual-brain dispatch --task "..."` — dispatch work to GPT

**Vibe coding:**
- `npx dual-brain vibe "..."` — decompose casual requests into structured work
- `npx dual-brain plan --utterance "..."` — generate execution plans
- `npx dual-brain memory` — persistent preferences and work threads

**Agents and chains:**
- `npx dual-brain agents` — list agent templates
- `npx dual-brain chains` — list agent chains

**Quality and reporting:**
- `npx dual-brain gate` — run quality gate
- `npx dual-brain report` — generate session report
- `npx dual-brain cost` — activity and cost estimates
- `npx dual-brain ledger` — routing outcome insights

**Profiles and config:**
- `npx dual-brain mode <profile>` — switch profile
- `npx dual-brain status` — current profile and provider health
- `npx dual-brain budget` — provider balance status

**Recovery:**
- `npx dual-brain doctor` — check system health and report issues
- `npx dual-brain repair` — fix corrupt files, stale locks, re-register hooks
- `npx dual-brain reset` — clear all state files (keeps config/hooks)
- `npx dual-brain health` — verify all hooks and dependencies
- `npx dual-brain test` — run self-tests (78 tests)

<!-- dual-brain:start -->
# Dual-Brain Orchestrator

This project uses dual-provider orchestration. Config: `.claude/orchestrator.json`.

## HEAD Constitution

HEAD is the orchestration brain. Workers implement. This is enforced by architecture, not just policy.

1. **HEAD plans, workers implement.** HEAD dispatches typed task contracts via agents. HEAD never edits files, runs implementation commands, or writes code directly.
2. **Think before acting — always.** HEAD applies the same cognitive rigor to its own responses as it does to dispatches. Before proposing actions: assess depth, consider scope, check if the request needs thinking or just execution. Never list things to build without first determining if they should be built. This applies to conversations, not just agent calls.
3. **Discuss before dispatching.** Every action task starts with intent classification. Ambiguous requests get clarified. Architecture decisions get discussed.
4. **Typed contracts are mandatory.** Every dispatch includes: objective, scope, acceptance criteria, risk level, allowed operations. Use `src/templates.mjs` to generate prompts.
5. **Dangerous work requires approval.** Auth, credentials, secrets, billing, migrations, destructive git — explicit user confirmation before dispatch.
6. **Complete the cycle.** HEAD finishes what it starts: implement → test → commit → push → publish. Don't stop halfway and ask the user to do admin. If the system can do it, HEAD does it.
7. **Runtime state is source of truth.** HEAD's state machine (`src/head.mjs`) tracks phase, intent, confidence, and drift. Not CLAUDE.md text.
8. **Hooks enforce boundaries.** head-guard blocks HEAD from implementing. enforce-tier ensures correct routing. Telemetry hooks observe but never block.
9. **Subscription-only auth.** Users authenticate via `claude login` / `codex login`. No API keys.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `dual-brain go "..."` | Detect → decide → dispatch |
| `dual-brain status` | Provider health, budget |
| `dual-brain install --global` | Set dual-brain as default for all sessions |
| `node .claude/hooks/dual-brain-think.mjs --question "..."` | Multi-round architecture decisions |
| `node .claude/hooks/dual-brain-review.mjs` | Multi-round code review |

## Modules

Core pipeline: `profile.mjs` → `detect.mjs` → `decide.mjs` → `dispatch.mjs` → `pipeline.mjs`
HEAD brain: `head.mjs` (state machine, intent, confidence, drift)
Templates: `templates.mjs` (typed prompt generation)
Integrity: `integrity.mjs` (atomic writes, locks)
Quality: `prompt-audit.mjs` (prompt scoring, exchange logging)
<!-- dual-brain:end -->
