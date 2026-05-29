# Cortex Capability Analysis — What NPX Cortex Must Achieve

> **Context**: Understanding what capabilities from the Rust backend and dual-brain archive inform the design of NPX Cortex as a standalone shell tool.

---

## Executive Summary

NPX Cortex must be a **standalone orchestration masterpiece** that captures the sophistication of dual-brain's routing intelligence while being completely independent of replit-tools and Claude Code hooks. The analysis reveals we have battle-tested patterns in both systems that can guide implementation.

**Key Finding**: Dual-brain achieved sophisticated multi-provider orchestration, but was deeply coupled to data-tools infrastructure. NPX Cortex can achieve the same intelligence as a self-contained tool.

---

## Critical Capabilities Analysis

### 1. **Multi-Provider Intelligence** (Core Value Proposition)

**From Dual-Brain Archive:**
- **Intent Classification**: `fix`/`add` → Execute tier, `explore`/`understand` → Search-then-Execute, `review` → dual-brain review chain
- **Risk Assessment**: File paths classified (auth/secrets → Critical, billing/migrations → High, tests/utils → Medium, docs → Low)
- **Adaptive Routing**: Auto-escalates tier on repeated failures, balances providers when one subscription is hot
- **Confidence × Stakes Matrix**: Routes to SOLO/VERIFY/DEBATE based on confidence and risk level
- **Provider Balance**: Tracks usage over rolling window, suggests GPT dispatch when Claude is hot

**From Rust Backend:**
- **UCB Bandit Algorithm**: Upper Confidence Bound for provider selection with success/failure tracking
- **Tier Definitions**: Search/Execute/Think with capability/cost mapping
- **Pressure Metrics**: Load/capacity tracking per provider

**NPX Cortex Must Have:**
```
Mise en place → Confidence scoring → Recipe selection → Cook → Plate & QA gate

Confidence factors:
- Domain fit (model strengths/weaknesses)
- Complexity penalty
- Historical success rate (from ledger)
- Single vs dual provider availability

Recipe matrix:
                 Low Stakes    Medium Stakes    High Stakes
High Confidence     SOLO          SOLO           VERIFY
Med Confidence      SOLO          VERIFY         DEBATE  
Low Confidence      VERIFY        DEBATE         DEBATE + gate
```

### 2. **Persistent State & Session Management** (Reliability Foundation)

**From Dual-Brain Archive:**
- **Atomic Operations**: tmp-file + rename pattern for all state updates (prevents corruption)
- **Session Resume**: `npx dual-brain resume` continues interrupted work
- **Daily Logs**: Rotated usage logs with token counts and routing decisions
- **Profile Persistence**: `.claude/dual-brain.profile.json` with custom budget overrides
- **Credential Management**: OAuth token refresh for both Claude and OpenAI with fallback paths

**From Rust Backend:**
- **Ledger Pattern**: Immutable JSONL event log with periodic DB reconciliation
- **State Abstraction**: `AppState` shared via `Arc<>` across async tasks
- **Configuration**: Environment variable loading with sensible defaults

**NPX Cortex State Layout:**
```
~/.cortex/                           # Global
├── config.json                      # Defaults, profile, model preferences  
├── auth/
│   ├── refresh-state.json           # Token expiry tracking
│   ├── claude-credentials.json      # OAuth tokens with refresh capability
│   └── openai-credentials.json     # OpenAI auth state
├── ledger.jsonl                     # Decision outcomes for learning
└── cli-versions.json                # Installed CLI versions + last-checked

<cwd>/.cortex/                       # Per-project
├── sessions/
│   ├── current.jsonl                # Active conversation (append-only)
│   └── archive/                     # Completed sessions
├── summary.json                     # Rolling context summary 
├── profile.json                     # Project-level routing overrides
└── memory/                          # Vibe memory for this project
```

### 3. **CLI Integration & Subprocess Management** (Execution Engine)

**From Dual-Brain Archive:**
- **CLI Detection**: Find Claude/Codex in PATH, check auth status, provide install guidance
- **Auth Status**: Parse JSON output from `claude auth status --json` and `codex login status`
- **Token Refresh**: Automatic OAuth refresh with proper client IDs and grant types
- **Subprocess Execution**: `spawnSync` with timeout, stdio capture, environment propagation

**From Rust Backend:**
- **Worker Pattern**: WebSocket communication for long-running sessions
- **Worktree Isolation**: Git worktree per execution to prevent conflicts
- **Output Streaming**: Line-by-line capture with progress events
- **Failure Classification**: CLI-not-found, auth-expired, exit-codes, stderr analysis

**NPX Cortex CLI Management:**
```javascript
// Detection & Auth
await detectProviders()  
// Returns: { claude: {installed: true, authed: true, subscription: "claude+"}, 
//           openai: {installed: false, authed: false, subscription: null} }

// Execution with streaming
for await (const chunk of executeProvider('claude', task, options)) {
  if (chunk.type === 'output') console.log(chunk.line);
  if (chunk.type === 'complete') return chunk.result;
}
```

### 4. **Conversation Engine** (User Experience)

**From Dual-Brain Archive:**
- **Natural Language Decomposition**: "fix the auth bug and also update the nav" → structured task list
- **Intent Compiler**: Casual requests → properly routed, risk-classified, quality-gated work
- **Plan Generation**: Steve-style 3-part markdown plans with dependency ordering
- **Session Context**: Maintains conversation history with rolling context window

**From Rust Backend:**
- **Context-Flow Pipeline**: Steps feed artifacts into downstream steps with token budgets
- **SSE Streaming**: Real-time progress updates to client
- **Request Correlation**: Request IDs for log correlation across async operations

**NPX Cortex Conversation Flow:**
```
User: "fix the auth bug and write tests"

[Mise en place] auth domain, high stakes, execute tier
[Confidence] 0.72 — medium (auth is historically tricky) 
[Recipe] VERIFY — Claude fixes, GPT reviews

Claude: I see the issue in login.ts:47...
[changes applied]

GPT review: Claude's fix looks correct. One edge case...

Claude: Good catch. Updated to handle that case too.

[Quality gate] ✓ Tests pass ✓ Auth flow works ✓ Ready to ship

You: _
```

### 5. **Dual-Brain Analysis Workflows** (Collaboration Patterns)

**From Dual-Brain Archive:**
- **Think Flow**: Round 1 (independent analysis) → Round 2 (cross-pollination) → Synthesis
- **Review Flow**: GPT reviews code → Claude provides second opinion → Final verdict
- **Dispatch Pattern**: Route isolated work to GPT via Codex while maintaining Claude context

**NPX Cortex Implementation:**
```javascript
// DEBATE pattern
async function runDebatePattern(task, context) {
  // Round 1: Independent analysis
  const [claudeR1, gptR1] = await Promise.all([
    executeProvider('claude', task, {isolation: true}),
    executeProvider('openai', task, {isolation: true})
  ]);
  
  // Round 2: Cross-pollination 
  const claudeR2 = await executeProvider('claude', {
    task,
    context: `GPT's analysis: ${gptR1.analysis}`
  });
  
  const gptR2 = await executeProvider('openai', {
    task, 
    context: `Claude's analysis: ${claudeR1.analysis}`
  });
  
  // Synthesis
  return synthesizeDebate(claudeR2, gptR2);
}
```

### 6. **Self-Healing & Quality Gates** (Reliability)

**From Dual-Brain Archive:**
- **Failure Detection**: 2+ failures on same prompt in 2 hours → auto-escalate tier
- **Auto-Retry**: Test failures and quality gate issues get 2 retries with fixes
- **Quality Gate**: Before ending session, run tests, check for issues, verify deliverables

**From Rust Backend:**
- **Verifier Pattern**: Structured verification with evidence collection
- **Circuit Breaker**: Stop trying after N consecutive failures
- **Health Checks**: Background monitoring of provider availability

**NPX Cortex Quality Assurance:**
```javascript
// Quality gate before completing work
async function qualityGate(changes, task) {
  const checks = [
    runTests(),
    validateSyntax(), 
    checkSecurityIssues(),
    verifyObjectiveMet(task.objective)
  ];
  
  const results = await Promise.allSettled(checks);
  const failures = results.filter(r => r.status === 'rejected');
  
  if (failures.length > 0) {
    // Auto-heal: attempt fixes up to 2 retries
    for (let retry = 0; retry < 2; retry++) {
      const fixes = await generateFixes(failures);
      await applyFixes(fixes);
      
      const recheckResults = await Promise.allSettled(checks);
      if (recheckResults.every(r => r.status === 'fulfilled')) break;
    }
  }
  
  return generateQualityReport();
}
```

---

## What NPX Cortex Does NOT Need From Backend

**Rust Backend capabilities that are BYOK/web-specific:**
- Clerk JWT authentication (NPX uses local auth files)
- Database persistence (NPX uses file-based state)
- WebSocket/SSE (NPX is CLI-based)
- Container management (NPX runs on user's machine)
- Billing integration (NPX is free)
- Team features (NPX is personal)

**What NPX inherits as concepts:**
- Router/scorer intelligence patterns
- Task contract structure  
- Provider abstraction
- State management patterns
- Configuration patterns
- Error handling approaches

---

## Implementation Priority Matrix

### **Phase 1: Foundation** (Working Chat)
- [x] CLI detection and auth checking
- [x] Basic conversation loop with persistence
- [x] SOLO pattern (single provider routing)
- [x] Session resume capability
- [x] Token refresh automation

### **Phase 2: Intelligence** (Master Chef)
- [ ] Risk classification from file paths and keywords
- [ ] Intent detection (fix/explore/review/think)
- [ ] Confidence scoring with domain fit analysis
- [ ] Recipe selection matrix (SOLO/VERIFY/DEBATE/SPECIALIZE)
- [ ] Provider balance tracking and recommendations

### **Phase 3: Collaboration** (Full Recipes)
- [ ] VERIFY pattern (primary + review)
- [ ] DEBATE pattern (dual-brain think workflow)
- [ ] SPECIALIZE pattern (parallel dispatch by strength)
- [ ] Quality gate with auto-healing
- [ ] Failure detection and tier escalation

### **Phase 4: Polish** (Production Ready)
- [ ] Vibe coding (natural language → structured tasks)
- [ ] Plan generation with dependency ordering
- [ ] Decision ledger and learning from outcomes
- [ ] Advanced configuration and profiles
- [ ] Cross-platform testing and packaging

---

## Key Architecture Decisions for NPX Cortex

### **1. Zero External Dependencies**
- Node 20+ builtins only (no npm packages)
- Self-contained token refresh (no external auth libraries)
- File-based persistence (no database)

### **2. Adaptive to User's Subscriptions**  
- Claude-only: SOLO + self-review, adversarial self-critique for DEBATE
- OpenAI-only: Same patterns with GPT as primary
- Dual-brain: Full recipe repertoire unlocked

### **3. Confidence-Driven, Not Keyword-Driven**
- Keywords feed into domain classification
- Confidence × stakes matrix drives recipe selection
- Honest uncertainty: surface disagreements, don't hide them

### **4. File-First State Management**
- Atomic writes with O_EXCL locks (from dual-brain pattern)
- JSONL append-only logs for events
- JSON files for configuration and state
- Rolling summaries to manage context size

### **5. Subprocess-Based Execution**
- Spawn Claude/Codex CLIs as subprocesses
- Stream output with progress indicators
- Capture structured results for further processing
- Handle timeouts and failure modes gracefully

---

## Success Metrics

**NPX Cortex succeeds when:**

1. **A Claude-only user** gets intelligent routing, self-review, and quality gates
2. **A GPT-only user** gets the same level of sophistication 
3. **A dual-brain user** gets purposeful collaboration, not random "ask both"
4. **Session resume** works flawlessly after interruption
5. **Quality gate** catches issues and auto-heals them
6. **Natural language** gets decomposed into structured, well-routed work
7. **Installation** is instant (`npx cortex`) with zero configuration required

The tool should feel like having a **master chef orchestrating your AI subscriptions** — purposeful, confidence-driven, never random, always improving.

---

## Next Steps

With this analysis complete, we now understand:

✅ **What dual-brain achieved** (sophisticated multi-provider orchestration)  
✅ **What replit-tools provided** (persistent state, CLI management, hooks)  
✅ **What Rust backend patterns** teach us (modern architecture approaches)  
✅ **What NPX Cortex must build** (standalone version of dual-brain intelligence)

**Ready to dispatch GPT agents for implementation** with proper understanding of the full scope and battle-tested patterns to leverage.