# Cortex — Orchestration Vision

> Rough vision — will solidify as we work through everything.
> Part of HeyVera. Formerly "dual-brain."

## What Cortex Is

Cortex is a multi-provider AI orchestration engine. One chat, many brains.

The user opens a project, talks to one intelligent chat, and gets work done. They do not think about which model, provider, worker, or session is doing the work. Cortex handles that.

Cortex is not an LLM. It is a lightweight routing engine with a thin conversation agent on top. The routing engine is deterministic — a weighted decision function that takes task shape, provider capacity, risk level, and history, then outputs a routing plan. The conversation agent is a rented frontier model (Haiku-class) that translates between natural language and structured routing decisions. The agent's context stays tiny because it only sees the current exchange plus a summary, never full work history.

Billing model TBD. x402 micropayments are planned as an internal settlement rail for future agent-to-agent and marketplace use. User-facing pricing for v1 will likely be prepaid credits or per-task billing — the billable unit should align with user-perceived value (tasks completed), not internal routing decisions.

## Where Cortex Fits in HeyVera

HeyVera is the platform. Soma is the heart. VeraAI is the observer. Cortex is a limb.

```
                  HeyVera (platform)
                       │
            ┌──────────┼──────────┐
            │          │          │
        Social    Marketplace   Cortex    ... future limbs
        Agent      Agent        Agent
            │          │          │
            └──────────┼──────────┘
                       │
                 every action
                 flows through
                       │
            ┌──────────┴──────────┐
            │                     │
         Soma                  VeraAI
         (heart)               (observer)
         identity              watches all work
         trust                 learns patterns
         reputation            improves routing
         provenance            becomes owned
                               intelligence
```

Every routing decision Cortex makes, every task completed, every outcome — will eventually flow through Soma (building reputation) and be observed by VeraAI (building intelligence). Soma wiring is planned from the start but VeraAI integration is deferred until Cortex works independently. Cortex ships first, Vera layers on later.

Cortex serves three purposes:
1. **Revenue now.** A paid service that works today.
2. **Dogfooding.** We use Cortex to build everything else — VeraAI, Soma, the frontend, future projects.
3. **Learning.** Building Cortex teaches us how to build VeraAI. The orchestration patterns, the telemetry, the decision-making — all feed the bigger system.

The strategy is recursive: build the tool, use the tool to build everything else.

## What Users Get

Two $20 cross-provider subscriptions ($20 Claude + $20 GPT) orchestrated efficiently outperform one $100 single-provider subscription that depends on the user's wisdom. Cortex makes cheap subscriptions punch above their weight.

Entry point: $20 + $20 + per-use Cortex fees. If a user only has one subscription, Cortex still helps with single-provider orchestration. The value scales with what the user brings.

The user experience:
- Open app, see projects
- Tap a project, see one chat
- Talk or type: "fix the login bug"
- Cortex routes work across providers, manages agents, handles retries
- Notification: "fix ready, 3 files changed"
- One tap to approve, or voice "show me what you changed"
- The chat stays clean — all agent noise happens underneath

## Architecture

Three layers. Clean boundaries between them.

### Layer 1: Client Apps

A chat interface. That's it.

Priority: web panel first, terminal second, desktop (Tauri) third, iOS (Swift/SwiftUI) fourth.

The web panel prototype already exists at `cortex/` (Vite + React + Tailwind). Long-term, the Cortex panel is a route within the main HeyVera Next.js app (which also serves social pages, marketplace, etc.). The existing prototype is a starting point, not the final home.

All clients talk to the same Cortex API. The shared layer across surfaces is the API contract and types, not UI components. Each surface uses its native-best framework:

| Surface | Tech | Reason |
|---------|------|--------|
| Web (all pages) | Next.js | SSR for social/marketplace (SEO), SPA-mode for Cortex chat |
| iOS | Swift/SwiftUI | Native. No cross-platform compromise. |
| Desktop | Tauri | Wraps the Next.js web app in a native Rust shell |
| Terminal | Rust CLI | Thin client, same API |

### Layer 2: Cortex Brain

**V1: runs locally** in the user's dev environment (Replit workspace, local machine). No server needed. This is how dual-brain already works — proven pattern, zero infra cost.

**V2: moves to HeyVera VPS** when team features, cross-device persistence, and multi-environment orchestration require a central brain.

This is the intelligence layer.

**Routing Engine** (the core IP)
- Deterministic weighted scoring function, not an LLM
- Inputs: task shape, available capacity, risk level, outcome history
- Outputs: routing plan (which provider, which model, which tier)
- Learns from outcomes over time — every decision is logged with its result
- Risk classification from file paths: auth/secrets=critical, billing/migrations=high, tests=medium, docs=low
- Provider pressure tracking: routes to the underused provider when one is hot

**Thin Conversation Agent**
- Rented LLM (Haiku-class or GPT-4.1-mini) on HeyVera's API key
- Only job: parse user intent into structured routing request, format agent results into human response
- Stateless per exchange — sees current message + compact summary, never full history
- Most intent parsing should be deterministic (pattern matching), LLM only for ambiguous inputs
- This minimizes per-user LLM cost

**Team/Org Management**
- Users, projects, subscription pools
- Subscription registry: users control their keys — lock them, set expiry, restrict to groups or personal use
- Two friends can combine subscriptions to work together
- Professional teams: quotas per user, priority queues, usage dashboards

**Telemetry + Learning**
- Every routing decision: task, available options, choice made, rationale
- Every outcome: success/failure, duration, retries needed
- Every user override: when the user disagrees with Cortex's choice
- This data feeds VeraAI's training pipeline and Soma's reputation system
- Schema must be right from day one — it's the hardest thing to change later

### Layer 3: Execution Environments (user-owned)

Cortex does not host code or run containers. It connects to environments the user already has.

**How it works today (proven with dual-brain):**
- User authenticates CLI tools in their environment: `claude login`, `codex login`
- Cortex Worker (lightweight process) runs alongside the authenticated tools
- Cortex Brain sends task instructions to the Worker via coordination protocol
- Worker spawns headless CLI sessions (Claude Code, Codex CLI, Gemini CLI)
- Results stream back to Cortex Brain, then to the user's chat
- No API keys needed. Subscription auth only. ToS compliance assumed for personal single-user use; team pooling and shared subscriptions require provider policy verification before shipping.

**Supported environments:**
- Replit workspaces (cloud, always-on, current dev environment)
- Local machines (user installs Worker — `npx cortex connect`)
- Any SSH-accessible server or VPS
- GitHub repos (cloned into whichever environment is available)
- Future: Codespaces, Gitpod, etc.

**The coordination protocol** is the nervous system. A lightweight, persistent connection between Cortex Brain and the Worker:
- Worker opens WebSocket to HeyVera servers on startup
- Cortex sends typed task contracts down (objective, scope, acceptance criteria, allowed operations)
- Worker streams results back (progress, file changes, test results, completion)
- Connection survives disconnects and resumes automatically
- Authenticated via HeyVera identity token

## Tech Stack

### Backend (Cortex Brain) — Rust

Rust is the long-term 10/10 choice. Validated by production systems: TensorZero (<1ms P99 at 10K QPS), Helicone AI Gateway, others.

Why Rust over Go or Node:
- Ownership model prevents data races at compile time — critical for a system managing shared subscriptions and routing state
- No garbage collector — deterministic memory, no pause-induced stutters during streaming
- Tokio async tasks are goroutine-equivalent with stronger safety guarantees
- 10-50x less memory than Node for equivalent concurrent connections — infrastructure efficiency is margin at this price point
- Single static binary deployment, no dependency hell
- Compiles to WASM for future edge/local-first capabilities

| Crate | Purpose |
|-------|---------|
| `tokio` | Async runtime, concurrent task management |
| `axum` | HTTP server, SSE/WebSocket, routing |
| `sqlx` | Compile-time checked Postgres queries |
| `fred` | Async Redis client with built-in pooling |
| `serde` | JSON serialization |
| `reqwest` | HTTP client for provider API calls + SSE consumption |
| `thiserror` + `anyhow` | Error handling |

Known gotcha: tower-http `CompressionLayer` buffers SSE streams. Exclude `text/event-stream` from compression.

Auth: no mature Rust auth library exists. Use external provider (Auth0/Clerk) for v1, validate tokens server-side. Roll own later if cost justifies.

### Frontend — Next.js (Web), Swift (iOS), Tauri (Desktop)

HeyVera is a platform with social, marketplace, and Cortex — not just a chat panel. The web frontend needs SSR for SEO-dependent pages (social, marketplace) and SPA-mode for real-time pages (Cortex chat). Next.js handles both patterns in one framework.

Existing prototype at `cortex/` (Vite + React + Tailwind) is a starting point. Migrate into the main HeyVera Next.js app as a route when the platform frontend is ready.

iOS in Swift/SwiftUI — native, no compromise. Shares the API contract and TypeScript types (via OpenAPI spec or similar), not UI components.

Desktop via Tauri — wraps the Next.js web app in a Rust native shell. Zero extra frontend work.

### Real-time Transport — SSE first, WebSocket ready

SSE for v1 — it's what ChatGPT and Claude.ai use. User sends messages via POST, receives streams via SSE.

Plan for WebSocket when multi-agent coordination needs bidirectional signaling (cancelling generation mid-stream, approving tool calls, steering agents). The industry is moving toward WebSocket for agentic use cases.

### Billing — TBD (x402 internal rail, user-facing model separate)

V1: free (local dogfood, single-user). User-facing pricing comes after the core loop is proven.

Future user-facing options: prepaid credits, per-task pricing, or monthly plan. The billable unit should be user-perceived value (tasks completed, time saved), not internal routing decisions.

x402 is the long-term internal settlement protocol for agent-to-agent commerce and marketplace transactions. `x402-axum` middleware exists and plugs directly into the stack. Coinbase runs free public facilitators on Base and Solana. This layer activates when HeyVera marketplace features ship, not for Cortex v1.

Privacy note: x402 payment metadata can leak URLs, descriptions, and context to facilitators. For a coding tool, redact repo names, issue descriptions, and security-sensitive paths before settlement.

## Interfaces to HeyVera Systems

Cortex is a limb. These are the joints where it connects to the body. Define them now, implement them as stubs for v1, wire them to real systems when Soma and VeraAI are ready.

### Soma Interface
```
Event: {
  actor: HeyVera identity (leaf in Soma),
  action: "routing_decision" | "task_complete" | "task_failed" | "user_override",
  subject: project/repo identifier,
  details: { provider, model, tier, duration, outcome },
  timestamp: ISO-8601
}
```
For v1: write events to a structured log file. Soma consumes them later.

### VeraAI Interface (deferred)

VeraAI integration is deferred until Cortex works independently. When wired in, VeraAI observes routing decisions and outcomes to build intelligence. Default observation level is metadata-only — no code content, no secrets, no user messages unless the user explicitly opts in.

For now: Cortex logs decisions and outcomes to a local append-only ledger. This data becomes VeraAI's training input when the time comes. Schema will be defined when VeraAI integration begins.

### Auth Interface
Cortex accepts a HeyVera identity token (JWT for v1). Does not maintain its own user database. User identity = Soma leaf.

### Billing Interface
Cortex emits usage events. HeyVera settles them.
```
Usage: {
  user: HeyVera identity,
  event: "routing_decision",
  cost_basis: computed from model/tier/tokens,
  timestamp: ISO-8601
}
```
For v1: log usage events locally. Wire to x402 settlement when HeyVera billing is live.

## What Exists as Source Material

`packages/dual-brain/` contains the v4.6.0 dual-brain package (14,724 lines across 28 modules). This is research material, not something to preserve exactly. Reusable patterns:

**Port the logic, not the code:**
- Risk classification (file path patterns, git churn awareness)
- Intent classification (NL goal to structured task)
- Agent templates (typed contracts with output expectations)
- Agent chains (multi-step workflows)
- Profile system (routing posture presets)
- Decision ledger (append-only outcome logging)

**Leave behind:**
- Hook system (Claude Code CLI-specific)
- TUI/control panel (terminal-specific)
- Install/setup wizard (CLI-specific)
- spawnSync-based execution (rewrite for async coordination protocol)

## Open Questions

1. **Connection protocol (v2).** When Cortex Brain moves to VPS for team features, how does it talk to execution environments? WebSocket from Worker to Cortex is the obvious choice, but needs design for: reconnection, authentication, message framing, backpressure, Replit container sleep/wake. Not a v1 problem (local-first eliminates it).

2. **Prepaid credits vs pure per-call.** Users may want spending predictability. Credit packs ($5, $10, $20) give that without requiring a subscription model.

3. **Multi-user subscription contention.** When two team members share a subscription pool and both need capacity simultaneously, how does Cortex arbitrate? Priority levels? Fair queuing? First-come-first-served?

4. **VeraAI training pipeline.** What's the minimum viable training loop? When does the deterministic router get replaced/augmented by a learned model? What user count provides meaningful training signal?

5. **Offline/degraded mode.** V1 is local so this isn't an issue. When Cortex Brain moves to VPS (v2), what happens when HeyVera servers are down? Cached routing rules as fallback?

## V1 Scope (the core loop)

V1 is the smallest thing that proves the product works. Nothing else ships until this is excellent.

**V1 delivers:**
- Single-user, local (runs in Replit workspace or local machine)
- One project at a time
- Two providers max (Claude + GPT, both BYO authenticated CLI tools)
- One chat interface (web panel)
- Deterministic routing engine (weighted scoring, no LLM needed for routing)
- Thin conversation agent (Haiku-class, for ambiguous intent only)
- Task execution via headless CLI sessions
- Reviewable diffs, test execution, user approval before write/commit
- Local append-only decision + outcome ledger
- Clean chat — all agent noise underneath

**V1 does NOT include:**
- Team features, shared subscriptions, subscription pooling
- x402 billing
- VeraAI integration
- Soma wiring (planned but stubbed)
- Central server / VPS
- Mobile app, desktop app
- Multi-project orchestration
- Agent hierarchy (manager/supervisor layers)

**The test:** Can Cortex take one coding request, choose between two local providers, produce a reviewable diff, run tests, log the decision and outcome, and let the user approve — without chat clutter?

## Principles

- Build slowly. Think from the foundation up. No dumb fixes, no patches on confusion.
- Every piece must be solid before the next piece goes on top.
- Cortex is a side project that enables the main projects. Ship it, use it, learn from it.
- The chat must stay clean. All complexity lives underneath.
- Deterministic where possible, LLM only where necessary.
- Log everything. The telemetry schema is the hardest thing to change and the most valuable thing to get right.
