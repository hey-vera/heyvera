# NPX Cortex — Implementation Plan

> **AI Org Chart Orchestration for Your Shell**
> Free tool. Zero dependencies. Local subprocess orchestration.
> Started: 2026-05-29

---

## What We're Building

`npx cortex` — a persistent AI chat that creates a **hierarchical AI organization** in your shell. Models work together like a company: workers handle simple tasks, ICs do the coding, managers step in when things get complex. Adapts to whatever subscriptions you have.

**Not VERIFY-everything.** Not random "ask both." **Purpose-driven escalation** where cheaper models admit when they need help, and expensive models only run when actually needed.

---

## The AI Org Chart

```
User talks to HEAD (Sonnet/GPT-5.4)
     │
     ├── DELEGATE DOWN to Worker (Haiku/GPT-4.1-mini)
     │   └── Simple tasks: grep files, run tests, format code
     │
     ├── ESCALATE UP to Manager (Opus/GPT-5.5) 
     │   └── When confidence < 0.5 or hits auth/billing/complex code
     │
     └── BOUNCE DOWN from Manager
         └── "Not yet, fix this specific issue and try again"
```

**The magic:** Each tier only sees what it needs. Workers get 1-2K token tasks. Managers get distilled problem summaries. No model burns tokens on full conversation context unless it needs to.

**The efficiency win:** Most conversations end at the IC level. Manager tier only runs when ICs admit they're stuck or work touches high-stakes areas.

---

## Core User Experience

```bash
$ npx cortex

Cortex v0.1.0
Detected: Claude (Opus/Sonnet/Haiku) ✓  GPT (5.5/5.4/4.1-mini) ✓
Mode: Hierarchical — AI org chart active

You: refactor the login function to handle OAuth refresh tokens

HEAD (Sonnet): Analyzing the login flow...
  ↳ DELEGATE → Worker (Haiku): map all auth-related files
  ↳ Worker found 12 files, confidence: 0.9 ✓
  
HEAD (Sonnet): Starting refactor... confidence: 0.4
  ↳ ESCALATE → Manager (Opus): auth is high-stakes + low confidence
  ↳ Manager: here's the safe refactor approach...
  ↳ BOUNCE DOWN → HEAD: implement this specific plan

HEAD (Sonnet): Implementing manager's plan... ✓ Complete

You: _
```

**Always transparent.** You see the delegation, escalation, and bouncing happen in real-time. Never a black box.

---

## Architecture

### System Components

```
npx-cortex/
├── package.json                  # bin: "cortex" → src/cli.mjs
├── src/
│   ├── cli.mjs                   # Entry: args, first-run, launch REPL
│   ├── repl.mjs                  # Conversation loop + hierarchy control
│   ├── chef.mjs                  # 3-tier orchestration engine  
│   ├── providers/
│   │   ├── claude.mjs            # claude -m opus/sonnet/haiku subprocess
│   │   ├── codex.mjs             # codex exec -m 5.5/5.4/4.1-mini subprocess  
│   │   └── detect.mjs            # CLI detection + auth status
│   ├── orchestrator/
│   │   ├── classify.mjs          # Task → tier + risk (from vibe-router)
│   │   ├── confidence.mjs        # Parse confidence from model output
│   │   └── handoffs.mjs          # Track escalations and bounces
│   ├── state/
│   │   ├── session.mjs           # JSONL conversation persistence
│   │   ├── plans.mjs             # In-flight work tree state
│   │   └── atomic.mjs            # Safe file writes with locking
│   └── auth/
│       └── refresh.mjs           # OAuth token refresh (Claude + GPT)
├── data/
│   └── orchestrator.json         # Model tiers + capabilities registry
└── templates/
    └── prompts/                  # Tier-specific prompt templates
```

### Local State (Zero Backend)

```
~/.cortex/                        # Global
├── config.json                   # Model preferences, thresholds
└── auth/
    └── refresh-state.json        # Token expiry tracking

<cwd>/.cortex/                    # Per-project (gitignored)
├── sessions/
│   ├── current.jsonl             # Active conversation
│   └── archive/                  # Completed sessions  
├── handoffs.jsonl                # Escalation audit log
└── plans/
    └── <plan_id>.json            # In-flight hierarchical work
```

---

## The Orchestration Engine

### The Three Operations

| Operation | Trigger | Implementation |
|-----------|---------|----------------|
| **DELEGATE DOWN** | Manager has plan with subtasks | `spawnSync('claude', ['-m', 'haiku', '-p', subtask])` |
| **ESCALATE UP** | Worker reports `confidence < 0.5` | `spawnSync('claude', ['-m', 'opus', '-p', escalationPrompt])` |
| **BOUNCE DOWN** | Manager review verdict: "rework" | Re-run IC with manager's critique appended |

### Escalation Triggers (V1 - No ML)

Workers escalate up when:
- Self-reported `confidence < 0.5` 
- Output contains "I don't know" / "I cannot determine"
- Subprocess exit code != 0
- Task touches sensitive paths (auth, billing, migrations)

Managers bounce down when:
- IC confidence < 0.6 on high-risk tasks
- Manager review finds specific issues to fix
- Critical file changes without tests added

### Context Envelopes (Efficiency Core)

| Direction | Content | Token Budget |
|-----------|---------|--------------|
| **DOWN (Manager → IC)** | Work order: objective + files + acceptance criteria | 200-500 tokens |
| **UP (IC → Manager)** | Escalation packet: what I tried + where I'm stuck | 500-1K tokens |
| **SIDEWAYS (User ↔ HEAD)** | Full conversation context + session summary | 4-8K tokens |

**Key insight:** Context doesn't multiply through hierarchy. Each tier gets exactly what it needs to do its job.

---

## Implementation Phases

### Phase 1: Basic Hierarchy (Week 1)

**Goal:** Prove the org chart concept works.

**Build:**
1. **CLI Detection** (adapt from `archive/dual-brain/install.mjs`)
   - Find `claude` and `codex` in PATH
   - Check auth status: `claude auth status --json`, `codex login status`
   - Detect available model tiers per provider

2. **Three-Tier Subprocess Engine**
   ```js
   // The entire hierarchy in ~40 lines
   async function runTier(tier, task, context) {
     const model = selectModel(tier, context.providers);
     const prompt = buildPrompt(tier, task, context);
     return spawnSync(model.bin, ['-m', model.id, '-p', prompt]);
   }
   ```

3. **Basic REPL + Persistence**
   - readline with history
   - Append user/assistant to `current.jsonl`
   - Resume session on restart

4. **Simple Classification**
   - Keywords → risk level (low/medium/high/critical)
   - Default to IC tier, escalate on high-risk or low confidence

**Success Metric:** Users can see models escalating and delegating with transparent reasoning.

### Phase 2: Smart Routing (Week 2)

**Goal:** Efficient model selection that saves tokens and improves quality.

**Add:**
1. **Confidence Parsing**
   - Models end responses with: `{"confidence": 0.7, "escalate": false, "reason": "..."}`
   - Parse structured output for escalation decisions

2. **Handoff Logging**
   ```json
   {"ts":1716998400000,"op":"escalate_up","from":"sonnet","to":"opus","reason":"auth_complexity","confidence":0.31}
   ```

3. **Manager Review Pattern**
   - High-stakes tasks get automatic manager review
   - Manager can bounce work back with specific feedback
   - Max 2 bounces before surfacing to user

4. **Single-Provider Graceful Degradation**
   - Claude-only: opus → sonnet → haiku hierarchy
   - GPT-only: gpt-5.5 → gpt-5.4 → gpt-4.1-mini hierarchy
   - Cross-provider escalation when both available

**Success Metric:** >25% of escalations result in measurably better output (user validation).

### Phase 3: Production Polish (Week 3)

**Goal:** Ready for real-world usage.

**Add:**
1. **OAuth Token Refresh** (adapt from `archive/dual-brain/install.mjs` lines 350-414)
   - Background refresh on startup
   - Handle expired tokens gracefully

2. **Work Tree Management** 
   - In-flight plans survive Ctrl+C and resume
   - Atomic writes for all state files
   - Session archiving when complete

3. **Error Handling & Recovery**
   - CLI not found → helpful install guidance
   - Auth expired → re-prompt flow
   - Model API errors → retry with backoff

4. **User Experience Polish**
   - Colored output for different tiers
   - Progress indicators during long operations  
   - `cortex --doctor` for system health checks

**Success Metric:** Zero friction installation and daily usage by power users.

---

## Technical Specifications

### CLI Integration Contracts

**Claude (all tiers):**
```bash
claude -p -m <opus|sonnet|haiku> --output-format stream-json "<prompt>"
```

**Codex (all tiers):**  
```bash
codex exec --json --ephemeral -m <gpt-5.5|gpt-5.4|gpt-4.1-mini> -s danger-full-access "<prompt>"
```

**Detection:**
```bash
claude auth status --json    # Check Claude auth + subscription
codex login status            # Check OpenAI auth
```

### Prompt Templates

**Worker Tier Template:**
```
You are a WORKER in an AI organization. Handle this specific task:

TASK: {{task}}
FILES: {{files}}
CONSTRAINTS: {{constraints}}

Work efficiently. If you're unsure about anything, be honest about your confidence level.

End your response with: {"confidence": 0.0-1.0, "escalate": true|false, "reason": "why"}
```

**Manager Tier Template:**
```
You are a MANAGER reviewing work from your team.

ORIGINAL REQUEST: {{user_request}}
IC ATTEMPT: {{ic_output}}
IC CONFIDENCE: {{ic_confidence}}

Either approve the work or provide specific feedback for improvement.

Respond with: {"verdict": "approve"|"bounce", "notes": "specific feedback"}
```

### State File Formats

**Handoffs Log (`handoffs.jsonl`):**
```json
{"ts":1716998400000,"plan_id":"p_42","op":"delegate_down","from":"opus","to":"haiku","task":"list auth files","confidence_out":0.91,"duration_ms":1200}
{"ts":1716998401200,"plan_id":"p_42","op":"escalate_up","from":"sonnet","to":"opus","reason":"unfamiliar_oauth_flow","confidence_in":0.31,"confidence_out":0.84,"duration_ms":8400}
```

**Work Plan (`plans/<id>.json`):**
```json
{
  "id": "p_42",
  "user_request": "refactor login to handle OAuth refresh",
  "status": "in_flight", 
  "created_at": 1716998400000,
  "subtasks": [
    {"id": "s_1", "task": "map auth files", "tier": "worker", "status": "complete", "confidence": 0.91},
    {"id": "s_2", "task": "design refactor", "tier": "ic", "status": "escalated", "attempts": 1}
  ]
}
```

---

## Success Metrics

### Primary: Escalation Value
> **Does the hierarchy catch real problems?** 
> Track: `useful_escalations / total_escalations > 25%`
> Method: After each manager intervention, ask user: "Was that helpful? [y/n]"

### Secondary: Efficiency  
> **Does the hierarchy save tokens vs VERIFY-everything?**
> Track: `average_tokens_per_conversation` (should be 30-50% of dual-verify)
> Method: Log token usage per tier in handoffs.jsonl

### Tertiary: User Retention
> **Do people keep using it?**
> Track: `sessions_per_week` after week 2 of usage
> Target: Users who try it continue daily usage

---

## What This Plan Delivers

### For Users:
- **Smart AI orchestration** that uses cheap models when possible, expensive ones when needed
- **Transparent reasoning** - see exactly why models escalate or delegate  
- **Works with any subscription combo** - Claude-only, GPT-only, or both
- **Local and private** - no data leaves your machine
- **Zero setup** - `npx cortex` just works

### For the Business:
- **Proof that sophisticated orchestration works** in a simple, local context
- **Foundation for BYOK platform** - same orchestration logic scales up
- **User validation** of hierarchical AI concepts before building enterprise version
- **Free marketing** - developers using NPX tool become BYOK platform prospects

---

## Files to Study Before Building

Critical patterns to reuse from `archive/dual-brain/`:

- `install.mjs` lines 350-414 — OAuth token refresh (Claude + GPT)
- `install.mjs` lines 417-510 — CLI detection across PATH + fallbacks  
- `gpt-work-dispatcher.mjs` — `codex exec --json` invocation + JSONL parsing
- `vibe-router.mjs` — task classification heuristics
- `risk-classifier.mjs` — file-path risk scoring
- `atomic-write.mjs` — O_EXCL lock + tmp+rename for safe writes
- `orchestrator.json` — model registry with tiers and capabilities

Don't rebuild what already works. Study, adapt, integrate.

---

**Ready to build the future of AI orchestration. The org chart starts here.**