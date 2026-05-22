# ClawNet - CLAUDE.md

Claude compatibility shim.

See `AGENTS.md` for the current repo instructions and workflow rules.

## Dual-Brain Orchestrator

This workspace uses dual-provider orchestration across Claude ($100 Max) and OpenAI ($100 Pro) subscriptions. Config: `.claude/orchestrator.json`.

**Two lanes — route by task shape:**
- **Claude lane** (fast, interactive): Haiku for search, Sonnet for execution, Opus for thinking
- **GPT lane** (parallel, isolated): GPT-4.1-mini for search, GPT-5.4 for execution, GPT-5.5 for thinking
- **Dual-brain** (both providers): Architecture decisions, security, large refactors

**Routing rules:**
1. Tasks under 3 min → Claude (Codex startup overhead not worth it)
2. Isolated tasks 3-10 min → GPT if OpenAI pressure is lower
3. Large isolated tasks 10+ min → Actively use GPT via `node .claude/hooks/gpt-work-dispatcher.mjs`
4. High-risk decisions → Dual-brain collaborative think (2-round dialogue):
   - Round 1: `node .claude/hooks/dual-brain-think.mjs --question "..."`
   - Analyze independently, then Round 2: `--round 2 --claude-says "<your analysis>"`
5. Check balance: `node .claude/hooks/budget-balancer.mjs`

**Agent output contracts — enforce when spawning subagents:**
- **Search agents** must return: exact files/symbols, line references, confidence, what wasn't checked
- **Execute agents** must return: files changed, behavior changed, tests run + results, edge cases, assumptions
- **Think agents** must return: decision + rationale, alternatives considered, risks, verification plan

**Sensitivity-based quality gate:**
- Low risk → self-check only (no GPT review)
- Medium risk → single-provider GPT review
- High risk → dual-brain review recommended
- Critical risk → dual-brain required + user permission

**Tier advisor:** PreToolUse hook classifies Agent calls, warns on mismatches, detects duplicates, suggests cross-provider routing when one subscription is underused.

**Budget balancer:** Tracks rolling 5-hour usage pressure per provider. When Claude is hot, suggests routing to GPT and vice versa.

**Vibe coding:** Speak naturally, the orchestrator handles structure.
- `node .claude/hooks/vibe-router.mjs "fix login and update nav"` — decompose into structured tasks
- `node .claude/hooks/plan-generator.mjs --utterance "..." --write` — 3-part execution plans
- `node .claude/hooks/vibe-memory.mjs` — persistent preferences and work threads
- Natural language profiles: "go aggressive", "be careful", "cheap mode", "fast"

## Cloudflare Pages — heyvera.org

- **Project**: heyvera.org on Cloudflare Pages
- **Trigger**: Auto-deploys on every push to `main` branch
- **Build settings**:
  - Root directory: `/web`
  - Build command: `npm run build`
  - Build output directory: `dist` (NOT `/dist`)
- **Workflow**: Push/merge to main → Cloudflare auto-builds → heyvera.org updates live
- **No submodules**: The repo must never have git submodule entries. If `dual-brain` or any other directory shows as mode `160000` in git, remove it with `git rm --cached <dir>` before merging to main — Cloudflare will fail on dangling submodule references.
