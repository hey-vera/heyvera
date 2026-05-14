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

**Two advisory hooks** are registered in `.claude/settings.json` and fire on each tool use. They detect and recommend — they do not execute actions without user confirmation:

- **enforce-tier.mjs** (PreToolUse on Agent): Classifies tasks, recommends the correct model tier, detects duplicates, suggests cross-provider routing
- **cost-logger.mjs** (PostToolUse on all tools): Logs usage to daily rotated files for cost tracking

**Three tiers route work by complexity:**

| Tier | Claude | OpenAI | Use for |
|------|--------|--------|---------|
| Search | Haiku | GPT-4.1-mini | grep, explore, file reads |
| Execute | Sonnet | GPT-5.4 | edits, tests, git ops |
| Think | Opus | GPT-5.5 | architecture, review, planning |

**Dual-brain** is recommended automatically for high-risk decisions — hooks detect the risk level and suggest dual-brain analysis, where both providers think on the same problem independently.

## Vibe Coding

Speak naturally. The orchestrator handles the structure.

```bash
# Decompose a casual request into structured work
node .claude/hooks/vibe-router.mjs "fix the login bug and also update the nav"

# Generate a Steve-style execution plan
node .claude/hooks/plan-generator.mjs --utterance "refactor the auth flow" --write

# Switch profiles with natural language
npx dual-brain mode "go aggressive"
npx dual-brain mode "be careful"
npx dual-brain mode "cheap"

# Check persistent preferences and work threads
node .claude/hooks/vibe-memory.mjs --threads
```

The vibe-router splits multi-task requests, classifies risk, assigns tiers, and recommends quality gates. The plan-generator produces 3-part plans (dependency-ordered tasks, user stories, questions with suggested answers). Vibe-memory learns your preferences over time.

## Scripts

| Script | Purpose |
|--------|---------|
| `hooks/vibe-router.mjs` | Decompose casual language into structured work orders |
| `hooks/plan-generator.mjs` | Generate Steve-style 3-part execution plans |
| `hooks/vibe-memory.mjs` | Persistent preferences, work threads, preference inference |
| `hooks/cost-report.mjs` | Activity & cost estimates by model tier |
| `hooks/dual-brain-review.mjs` | Send git diff to GPT for independent review |
| `hooks/dual-brain-think.mjs` | Dual-perspective analysis on architecture decisions |
| `hooks/quality-gate.mjs` | Sensitivity-scored quality gate with review artifacts |
| `hooks/budget-balancer.mjs` | Provider balance and routing recommendations |
| `hooks/gpt-work-dispatcher.mjs` | Dispatch execution tasks to GPT via Codex CLI |
| `hooks/session-report.mjs` | Session-end summary: activity, compliance, quality |
| `hooks/health-check.mjs` | Verify all hooks and dependencies are working |
| `hooks/test-orchestrator.mjs` | Self-test harness (40 tests) |
| `hooks/setup-wizard.mjs` | Interactive config (optional — for custom plans) |
| `hooks/install-git-hooks.mjs` | Git pre-commit hook for quality gate |

## CLI options

```bash
npx -y dual-brain              # detect, configure, install
npx dual-brain --force          # overwrite all config
npx dual-brain --dry-run        # detect only, don't write
npx dual-brain --json           # output detection as JSON
npx dual-brain --help           # show help
```

## Customize

After install, edit these files:

- `orchestrator.json` — subscriptions, tiers, quality gate, budgets, routing
- `review-rules.md` — project-specific rules for GPT code review
- `settings.json` — hook registrations (auto-generated, safe to extend)

## Profiles

The active profile controls routing posture, budgets, and quality gate behavior. Default: **auto**.

```bash
npx dual-brain mode cost-saver   # switch profile
npx dual-brain status            # check current profile and provider health
```

- **auto** (default): Adapts routing based on task risk, provider health, and outcomes. Auto-escalates tier on repeated failures.
- **balanced**: Best model per tier, normal budgets, reviews at medium+ risk.
- **cost-saver**: Prefer cheaper models, lower budgets, skip GPT for non-critical work.
- **quality-first**: Dual-brain for medium+ risk, higher budgets, stricter reviews.

## Troubleshooting

**Hooks not firing** -- Run `node .claude/hooks/health-check.mjs`. Check that `.claude/settings.json` has the hook entries. Re-run `npx dual-brain` to re-register.

**Codex/GPT features unavailable** -- Run `codex --version` and `codex login`. If Codex CLI isn't installed: `npm i -g @openai/codex`. Re-run `npx dual-brain` to detect.

**Auth expired** -- Run `claude login` for Claude, `codex login` for OpenAI. Re-run `npx dual-brain` to re-detect.

**Duplicate warnings every time** -- Normal during agent waves (3+ agents in 90s). The system auto-suppresses. If persistent with single agents, check for identical task descriptions.

**Budget warnings too aggressive/too lenient** -- Switch profile: `npx dual-brain mode cost-saver` or `npx dual-brain mode quality-first`. Or set custom limits with `npx dual-brain budget <session$> [daily$]`.

**Corrupt state / weird behavior** -- Remove state files and re-run: `rm .claude/dual-brain.profile.json .claude/hooks/dual-brain.*.json 2>/dev/null; npx dual-brain`

**Multiple Claude Code sessions** -- State files may have brief write conflicts. Each session tracks independently. Use a single session for best results.

**Uninstall** -- `npx dual-brain --uninstall` removes hooks from settings.json and cleans state files.

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
