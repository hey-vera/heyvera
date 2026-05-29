# NPX Cortex — Build Plan

> Free shell tool. Master chef AI orchestration.
> Started: 2026-05-29

---

## What We're Building

`npx cortex` — a persistent AI chat for any shell that intelligently orchestrates Claude and GPT. Adapts to whatever subscriptions the user has. When both are available, combines them like a master chef: confidence-driven, purposeful, never random.

**Not a hook system.** Not a wrapper around Claude Code. Cortex owns the conversation loop and drives the CLIs as subprocesses.

---

## What Already Exists (archive/dual-brain/)

**Portable, reusable logic (study + adapt):**
- `gpt-work-dispatcher.mjs` — `codex exec --json` invocation + JSONL result parsing
- `vibe-router.mjs` — task decomposition, tier/risk classification from natural language
- `risk-classifier.mjs` — file-path risk scoring, sensitive-path detection
- `dual-brain-think.mjs` — 2-round Claude↔GPT dialogue (debate mechanic)
- `dual-brain-review.mjs` — cross-model code review
- `quality-gate.mjs` — risk→approval mapping, review on changed files
- `decision-ledger.mjs` — records decisions + outcomes, provider win rates
- `atomic-write.mjs` — O_EXCL lock + tmp+rename for safe concurrent writes
- `orchestrator.json` — model registry: tiers, strengths, weaknesses, pricing
- `install.mjs` lines 350-414 — OAuth token refresh for Claude + Codex (the code that replaces replit-tools)
- `install.mjs` lines 417-510 — CLI detection across PATH + fallback locations

**Not portable (hook-system-specific, rewrite needed):**
- `enforce-tier.mjs` — logic is good but it's a Claude Code PreToolUse hook
- `ship-captain.mjs` — good orchestration patterns but deeply coupled to hooks
- `cost-logger.mjs`, `budget-balancer.mjs` — useful concepts, need full rewrite
- `vibe-memory.mjs` — interesting but not v1

---

## Architecture

### Core Loop (what the user experiences)

```
$ npx cortex

Cortex v0.1.0
Detected: Claude (Opus 4.6) ✓  GPT (5.5) ✓
Mode: Dual-brain — master chef orchestration active

You: fix the auth bug in login.ts

[Mise en place] auth domain, high stakes, execute tier
[Confidence] 0.72 — medium (auth is historically tricky)
[Recipe] VERIFY — Claude fixes, GPT reviews

Claude: I see the issue in login.ts:47...
[changes applied]

GPT review: Claude's fix looks correct. One edge case...

Claude: Good catch. Updated to handle that case too.

You: _
```

### System Components

```
npx-cortex/
├── package.json                  # bin: "cortex" → src/cli.mjs
├── src/
│   ├── cli.mjs                   # Entry point: arg parsing, first-run, launch REPL
│   ├── repl.mjs                  # The conversation loop (readline, streaming, history)
│   ├── providers/
│   │   ├── claude.mjs            # Spawn `claude -p --output-format stream-json`
│   │   ├── codex.mjs             # Spawn `codex exec --json --ephemeral`
│   │   └── detect.mjs            # CLI detection + auth status + version check
│   ├── orchestrator/
│   │   ├── chef.mjs              # 5-stage decision loop
│   │   ├── classifier.mjs        # Task analysis: tier + risk + domains (from vibe-router)
│   │   ├── confidence.mjs        # Confidence scoring (simple v1, calibration v2)
│   │   └── recipe.mjs            # (confidence × stakes) → SOLO|VERIFY|DEBATE|SPECIALIZE
│   ├── patterns/
│   │   ├── solo.mjs              # Single model, streaming response
│   │   ├── verify.mjs            # Primary creates → secondary reviews
│   │   ├── debate.mjs            # 2-round independent analysis → synthesis
│   │   └── specialize.mjs        # Parallel dispatch by model strength
│   ├── state/
│   │   ├── session.mjs           # Append-only JSONL conversation persistence
│   │   ├── config.mjs            # Global + per-project config (merge, locked writes)
│   │   ├── ledger.mjs            # Decision outcomes for learning (from decision-ledger)
│   │   └── atomic.mjs            # O_EXCL lock + tmp+rename (from atomic-write)
│   └── auth/
│       ├── refresh.mjs           # OAuth token refresh for Claude + Codex
│       └── install.mjs           # Auto-install CLIs when missing
├── data/
│   └── orchestrator.json         # Model registry (adapted from archive)
└── test/
    └── ...
```

### State Layout (on disk)

```
~/.cortex/                        # Global
├── config.json                   # Defaults, profile, model preferences
├── auth/
│   └── refresh-state.json        # Token expiry tracking
└── cli/
    └── versions.json             # Installed CLI versions + last-checked

<cwd>/.cortex/                    # Per-project (gitignored)
├── sessions/
│   ├── current.jsonl             # Active conversation (append-only)
│   └── archive/                  # Completed sessions
├── summary.json                  # Rolling context summary for continuity
├── ledger.jsonl                  # Decision outcomes
└── config.json                   # Project-level overrides
```

---

## The Master Chef (Orchestration Logic)

### Confidence × Stakes → Recipe

```
                    stakes →
                 low       medium      high/critical
            ┌──────────┬───────────┬──────────────────┐
  C ≥ 0.8   │  SOLO    │   SOLO    │  VERIFY          │
            ├──────────┼───────────┼──────────────────┤
  0.5-0.8   │  SOLO    │  VERIFY   │  DEBATE          │
            ├──────────┼───────────┼──────────────────┤
  C < 0.5   │  VERIFY  │  DEBATE   │  DEBATE + gate   │
            └──────────┴───────────┴──────────────────┘

  Complex + parallel tasks → SPECIALIZE (overrides above)
```

### V1 Confidence (simple, no calibration yet)

```js
function estimateConfidence(task, availableProviders) {
  let C = 0.7; // baseline
  
  // Domain fit: does the primary model excel here?
  if (primaryModelStrengths.includes(task.domain)) C += 0.15;
  if (primaryModelWeaknesses.includes(task.domain)) C -= 0.2;
  
  // Complexity penalty
  if (task.complexity === 'complex') C -= 0.15;
  
  // Single provider penalty (can't verify externally)
  if (availableProviders.length === 1) C -= 0.1;
  
  return clamp(C, 0, 1);
}
```

V2 adds historical calibration from the ledger (S_hist signal).

### Adaptive Mode

```
detect() → { claude: true/false, codex: true/false }

Claude-only:  SOLO always uses Claude. VERIFY = Claude + self-critique.
              DEBATE = Claude argues both sides (adversarial prompt).
GPT-only:     Same pattern with GPT as primary.
Dual-brain:   Full recipes — VERIFY and DEBATE use the other provider.
```

### Graceful Degradation

When dual-brain recipes can't run (missing provider):
- VERIFY → SOLO + structured self-review prompt
- DEBATE → SOLO + adversarial self-critique (argue against your own answer)
- SPECIALIZE → sequential single-provider with tier routing

---

## Build Phases

### Phase 1: Working Chat (the foundation)

**Goal:** `npx cortex` → persistent conversation that actually works.

1. **Package scaffolding**
   - package.json with `"bin": { "cortex": "src/cli.mjs" }`
   - Zero npm dependencies (Node 20+ builtins only)

2. **CLI detection** (adapt from install.mjs)
   - Detect Claude CLI + Codex CLI across PATH
   - Check auth status for each
   - Prompt to install missing CLIs
   - Prompt to auth unauthed CLIs

3. **Conversation REPL** (the core — this is most of the work)
   - readline interface with history
   - Spawn `claude -p --output-format stream-json` for Claude
   - Spawn `codex exec --json --ephemeral` for GPT
   - Stream response chunks to terminal with formatting
   - Build conversation context (rolling window)
   - Handle Ctrl+C, Ctrl+D, errors gracefully

4. **Session persistence**
   - Append-only JSONL (user msg, assistant msg, metadata)
   - Resume conversation on next `npx cortex` launch
   - Rolling summary when session exceeds token threshold

5. **SOLO pattern** (just route to the right model)
   - Basic tier classification from vibe-router patterns
   - Primary model = whichever the user has (prefer Claude if both)

**Deliverable:** A working chat that persists across sessions, uses whichever CLI(s) the user has authenticated.

### Phase 2: The Chef (intelligent routing)

**Goal:** Cortex makes smart decisions about how to handle each request.

1. **Task classifier** (adapt vibe-router.mjs + risk-classifier.mjs)
   - Tier detection: search/execute/think
   - Risk detection: low/medium/high/critical from keywords + file paths
   - Domain extraction: auth, billing, UI, tests, etc.

2. **Confidence scoring** (v1 — simple heuristics)
   - Domain-model fit from orchestrator.json
   - Complexity assessment
   - Single vs dual provider penalty

3. **Recipe selection**
   - (confidence × stakes) matrix lookup
   - Mode-aware (degrade gracefully for single provider)

4. **VERIFY pattern**
   - Primary model produces answer
   - Secondary model reviews for errors (not rewrite)
   - Primary incorporates feedback
   - Adapt dual-brain-review.mjs mechanics

**Deliverable:** Cortex chooses SOLO vs VERIFY intelligently. Single-provider users get self-review fallback.

### Phase 3: Full Recipes

**Goal:** All four collaboration patterns working.

1. **DEBATE pattern** (adapt dual-brain-think.mjs)
   - Round 1: both models analyze independently
   - Round 2: each sees the other's analysis
   - Synthesis: agreements proceed, disagreements surfaced to user
   - Single-provider fallback: adversarial self-critique

2. **SPECIALIZE pattern**
   - Split complex work by model strengths
   - Parallel dispatch (adapt gpt-work-dispatcher.mjs)
   - Integration review of the seams
   - Concurrent execution with timeout handling

3. **Quality gate** (adapt quality-gate.mjs)
   - Stakes-appropriate validation
   - Self-correction loop (2 retries)
   - Honest uncertainty surfacing

**Deliverable:** Full master chef — purposeful, confidence-driven orchestration across all patterns.

### Phase 4: Polish

**Goal:** Production-ready, delightful to use.

1. **OAuth token refresh** (port from install.mjs lines 350-414)
   - Background refresh on launch
   - Re-prompt on refresh failure
   - No replit-tools dependency

2. **Decision ledger + learning**
   - Record outcomes per decision
   - Feed into confidence calibration (v2)
   - Per-repo adaptation over time

3. **CLI update management**
   - Async version check (non-blocking)
   - Pin known-good version ranges
   - Nudge to update when behind

4. **User experience polish**
   - Colored output, progress indicators
   - Recipe transparency ("Using VERIFY because auth is high-stakes")
   - `cortex --doctor`, `--reset`, `--status` commands
   - Cross-platform testing

**Deliverable:** Published npm package, ready for real users.

---

## What This Plan Does NOT Include

- Cortex web app / BYOK platform (separate product, separate plan)
- Team features, subscription delegation
- Soma/Vera integration
- Mobile app

This is purely the free shell tool. The platform is a different project.

---

## Key Decisions

1. **Zero npm dependencies.** Node 20+ builtins only. Keeps install instant and eliminates supply-chain risk.
2. **Claude and GPT are equal citizens.** Neither is "primary" — the user's available tools determine the mode.
3. **Confidence drives recipes, not keywords.** Keywords feed the classifier, but the recipe decision is (confidence × stakes), not "if auth then debate."
4. **Honest about uncertainty.** When the chef isn't sure, it says so. Disagreements between models are surfaced, not hidden.
5. **Ship Phase 1 fast.** A working persistent chat with basic routing is more valuable than a perfect orchestration engine nobody can use.
