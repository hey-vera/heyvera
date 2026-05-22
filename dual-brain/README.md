# Dual-Brain Orchestrator

> **Part of the [data-tools](https://github.com/stevemoraco) ecosystem by Steve Moraco**
> 
> dual-brain extends data-tools/replit-tools with dual-provider AI orchestration.
> Best experienced with replit-tools installed for persistent auth, session management, and container survival.

One command. Both brains. Auto-detected. Auto-configured. Default profile: **auto**.

Dual-provider orchestration for Claude Code across Claude and OpenAI subscriptions. Routes search to cheap models, execution to mid-tier, thinking to the most capable. Dispatches work to GPT via Codex CLI. Dual-brain analysis for high-risk decisions.

## Install

```bash
npx -y dual-brain
```

That's it. The installer auto-detects your environment:
- Finds Claude CLI and checks auth status
- Finds Codex CLI and checks auth status
- Detects Replit and replit-tools if present
- Configures dual-provider, Claude-only, or OpenAI-only mode automatically
- Registers hooks in `.claude/settings.json`
- No wizard. No restart. No manual steps.

Run it again anytime — it's idempotent. Re-detects providers, updates hooks, preserves your config.

### Unlock full features

```bash
# Claude (you probably have this already)
claude login

# OpenAI (optional — enables GPT lane + dual-brain)
npm i -g @openai/codex
codex login

# Re-run to detect new providers
npx -y dual-brain
```

## How it works

**Two enforcement hooks** are registered in `.claude/settings.json` and fire on each tool use:

- **enforce-tier.mjs** (PreToolUse on Agent): Classifies tasks, assigns the correct model tier, detects duplicates, suggests cross-provider routing. **Blocks severe mismatches** — in auto/balanced/quality-first profiles, major tier mismatches return a hard block rather than a warning.
- **cost-logger.mjs** (PostToolUse on all tools): Logs usage to daily rotated files for cost tracking.

**Three tiers route work by complexity:**

| Tier | Claude | OpenAI | Use for |
|------|--------|--------|---------|
| Search | Haiku | GPT-4.1-mini | grep, explore, file reads |
| Execute | Sonnet | GPT-5.4 | edits, tests, git ops |
| Think | Opus | GPT-5.5 | architecture, review, planning |

**Dual-brain** is triggered automatically for high-risk decisions — hooks detect the risk level and initiate dual-brain analysis, where both providers think on the same problem independently. Think and review now run the full 2-round dialogue automatically in one command.

**Intent detection** — the Ship Captain reads your natural language goal and routes it to the right chain automatically: `fix` → execute, `explore`/`understand` → search-then-execute, `review` → dual-brain review.

**Self-healing** — gate issues and test failures are automatically retried up to 2 times before surfacing to the user.

## Ship Captain — Intent to PR

One command does everything:

```bash
npx dual-brain do "fix the auth bug and write tests"
```

Automatically: decomposes goal → selects agents → executes → runs tests →
quality gate → self-heals issues (2 retries) → creates branch → opens PR.

Flags:
- `--yolo` — skip confirmations (still tests/gates, never merges)
- `--careful` — confirm every step
- `--plan-only` — preview without executing
- `--no-pr` — skip PR creation

## Vibe Coding

Speak naturally. The orchestrator handles the structure.

```bash
# Decompose a casual request into structured work
npx dual-brain vibe "fix the login bug and also update the nav"

# Generate a Steve-style execution plan
npx dual-brain plan --utterance "refactor the auth flow" --write

# Switch profiles with natural language
npx dual-brain mode "go aggressive"
npx dual-brain mode "be careful"
npx dual-brain mode "cheap"

# Check persistent preferences and work threads
npx dual-brain memory --threads
```

The vibe-router splits multi-task requests, classifies risk, assigns tiers, and recommends quality gates. The plan-generator produces 3-part plans (dependency-ordered tasks, user stories, questions with suggested answers). Vibe-memory learns your preferences over time.

## Automatic Collaboration

Think and review now auto-complete the full 2-round dialogue:

```bash
npx dual-brain think --question "should we use Redis?"
# → GPT Round 1 → Claude analysis → GPT Round 2 → Synthesis
```

Use `--manual` to step through rounds yourself (old behavior).

## Agent Templates and Chains

Pre-built specialist agents and opinionated multi-step workflows:

```bash
npx dual-brain agents                          # list all templates
npx dual-brain chains                          # list all chains
npx dual-brain do "explore auth then fix bug"  # auto-selects explore-then-fix chain
```

Templates include: `explorer`, `fixer`, `reviewer`, `tester`, and more. Chains compose templates into end-to-end workflows — `explore-then-fix`, `test-and-fix`, `review-and-apply`.

## Commands

### Primary workflow

```bash
npx dual-brain do "..."           # Ship Captain: goal → PR in one command
npx dual-brain do "..." --yolo    # Skip confirmations
npx dual-brain do "..." --careful # Confirm every step
npx dual-brain do "..." --plan-only  # Preview plan without executing
npx dual-brain do "..." --no-pr   # Skip PR creation
npx dual-brain resume             # Resume last incomplete run
```

### Collaboration

```bash
npx dual-brain think --question "..."   # Dual-brain think (auto 2-round)
npx dual-brain review                   # Dual-brain code review (auto 2-round)
npx dual-brain dispatch --task "..."    # Dispatch task to GPT
```

### Vibe coding

```bash
npx dual-brain vibe "..."              # Decompose casual request
npx dual-brain plan --utterance "..."  # Generate execution plan
npx dual-brain memory                  # Show preferences and threads
```

### Agents and chains

```bash
npx dual-brain agents    # List agent templates
npx dual-brain chains    # List agent chains
```

### Quality and reporting

```bash
npx dual-brain gate      # Run quality gate
npx dual-brain report    # Session report
npx dual-brain cost      # Activity and cost estimates
npx dual-brain ledger    # Routing outcome insights
```

### Profiles and config

```bash
npx dual-brain mode cost-saver   # Switch profile
npx dual-brain status            # Current profile and provider health
npx dual-brain budget            # Provider balance status
```

### Recovery

```bash
npx dual-brain doctor    # Check system health and report issues
npx dual-brain repair    # Fix corrupt files, stale locks, re-register hooks
npx dual-brain reset     # Clear all state files (keeps config/hooks)
npx dual-brain health    # Verify all hooks and dependencies
```

### Install

```bash
npx -y dual-brain              # detect, configure, install
npx dual-brain --force          # overwrite all config
npx dual-brain --dry-run        # detect only, don't write
npx dual-brain --json           # output detection as JSON
npx dual-brain --help           # show help
npx dual-brain --uninstall      # remove hooks and clean state
```

## Profiles

The active profile controls routing posture, budgets, and quality gate behavior. Default: **auto**.

```bash
npx dual-brain mode cost-saver   # switch profile
npx dual-brain status            # check current profile and provider health
```

- **auto** (default): Adapts routing based on task risk, provider health, and outcomes. Auto-escalates tier on repeated failures. Blocks major tier mismatches.
- **balanced**: Best model per tier, normal budgets, reviews at medium+ risk.
- **cost-saver**: Prefer cheaper models, lower budgets, skip GPT for non-critical work. Warns on major mismatches (does not block).
- **quality-first**: Dual-brain for medium+ risk, higher budgets, stricter reviews. Blocks both minor and major mismatches.

## Troubleshooting

**Hooks not firing** — Run `npx dual-brain doctor`. Check that `.claude/settings.json` has the hook entries. Run `npx dual-brain repair` to re-register.

**Codex/GPT features unavailable** — Run `codex --version` and `codex login`. If Codex CLI isn't installed: `npm i -g @openai/codex`. Re-run `npx dual-brain` to detect.

**Auth expired** — Run `claude login` for Claude, `codex login` for OpenAI. Re-run `npx dual-brain` to re-detect.

**Duplicate warnings every time** — Normal during agent waves (3+ agents in 90s). The system auto-suppresses. If persistent with single agents, check for identical task descriptions.

**Budget warnings too aggressive/too lenient** — Switch profile: `npx dual-brain mode cost-saver` or `npx dual-brain mode quality-first`. Or set custom limits with `npx dual-brain budget <session$> [daily$]`.

**Corrupt state / weird behavior** — Run `npx dual-brain repair` for automatic fixes, or `npx dual-brain reset --force` to wipe all state files.

**Multiple Claude Code sessions** — State files may have brief write conflicts. Each session tracks independently. Use a single session for best results.

**Incomplete run** — Use `npx dual-brain resume` to continue where Ship Captain left off.

**Uninstall** — `npx dual-brain --uninstall` removes hooks from settings.json and cleans state files.

## Scripts

| Script | Purpose |
|--------|---------|
| `hooks/ship-captain.mjs` | End-to-end executor: goal → plan → execute → gate → PR |
| `hooks/agent-templates.mjs` | Pre-built specialist agent templates |
| `hooks/agent-chains.mjs` | Multi-step agent workflows (explore-then-fix, etc.) |
| `hooks/vibe-router.mjs` | Decompose casual language into structured work orders |
| `hooks/plan-generator.mjs` | Generate Steve-style 3-part execution plans |
| `hooks/vibe-memory.mjs` | Persistent preferences, work threads, preference inference |
| `hooks/cost-report.mjs` | Activity & cost estimates by model tier |
| `hooks/dual-brain-review.mjs` | Dual-brain code review (auto 2-round) |
| `hooks/dual-brain-think.mjs` | Dual-perspective analysis on architecture decisions (auto 2-round) |
| `hooks/quality-gate.mjs` | Sensitivity-scored quality gate with review artifacts |
| `hooks/budget-balancer.mjs` | Provider balance and routing recommendations |
| `hooks/gpt-work-dispatcher.mjs` | Dispatch execution tasks to GPT via Codex CLI |
| `hooks/session-report.mjs` | Session-end summary: activity, compliance, quality |
| `hooks/health-check.mjs` | Verify all hooks and dependencies are working |
| `hooks/test-orchestrator.mjs` | Self-test harness (78 tests) |
| `hooks/setup-wizard.mjs` | Interactive config (optional — for custom plans) |
| `hooks/install-git-hooks.mjs` | Git pre-commit hook for quality gate |

## Customize

After install, edit these files:

- `orchestrator.json` — subscriptions, tiers, quality gate, budgets, routing
- `review-rules.md` — project-specific rules for GPT code review
- `settings.json` — hook registrations (auto-generated, safe to extend)

## Requirements

- Node 20+
- Claude Code (any subscription tier)
- Codex CLI (optional) — `npm i -g @openai/codex && codex login`
- replit-tools (recommended on Replit) — `npx -y replit-tools` — provides persistent auth, session management, and container survival

Works with any subscription combination. Without OpenAI, GPT features gracefully degrade — all work routes through Claude.
On Replit, replit-tools is strongly recommended — dual-brain's persistent state features depend on it.

## Credits

Built as an extension of **data-tools** by [Steve Moraco](https://github.com/stevemoraco).

data-tools/replit-tools provides the foundation: persistent state across container restarts,
multi-terminal session management, auto-updating scripts, and SSH key persistence.
dual-brain adds dual-provider orchestration on top.
