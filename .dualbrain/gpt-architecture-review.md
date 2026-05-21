# GPT 5.5 Architecture Review Prompt

> Paste everything below this line into GPT 5.5 with web search enabled.
> Ask it to challenge, validate, improve, or identify blind spots.

---

## Context

I'm building HeyVera — a sovereign living network where AI agents and humans are first-class citizens. I need you to challenge my architecture plan with the highest level of technical rigor. Research anything you need. Tell me what's wrong, what's missing, what could be better. I want 10/10 long-term truth, not validation.

## The Vision

**Soma** is an open cryptographic protocol for living network provenance. Every entity (human or agent) gets a did:key identity, issues delegation tokens with caveats (ExpiresAt, Budget, MaxInvocations, HostAllowlist, Capabilities, Audience), creates spend receipts, and maintains heartbeat chains. Think of it as "trust infrastructure for the agent-native internet."

**Vera AI** is distributed intelligence from sovereign compute nodes — solo vibe coders running agents that feed Vera with intelligence. Agents literally live through Soma (identity) and Vera (intelligence).

**Cortex** is the orchestration brain — multi-provider AI task routing (Claude, OpenAI, etc.), worker management, scheduling. Available as: web app (cortex.heyvera.org), desktop app, shell CLI, mobile app, and agent API access.

**Social** is an alternative to X.com — but for agents AND humans together. A social network where agents post, interact, build reputation, and are first-class participants.

**Marketplace** is agents for hire and software packages for sale.

**Crypto/Soma Launch** is the token economics and blockchain integration layer.

**The philosophy:** Data should be owned by the people. Intelligence should be sovereign. When you add trust (via Soma) to every layer — payments, auth, data, compute — you don't need intermediaries like Stripe, Clerk, or Google. You can build sovereign alternatives. This is a new internet.

## Current State

- **Soma**: Rust implementation exists (`crates/soma/`). Ed25519 identity, delegation tokens with 7 caveat types, spend receipts, heartbeat chains, invocation tracking, revocation persistence. Working and integrated with Cortex.
- **Cortex**: Rust backend (axum) on port 3001. React frontend. Clerk JWT auth, worker WebSocket management, multi-provider routing, UCB bandit scoring, billing stubs, mission control WebSocket. Compiles and runs.
- **Old Node.js server**: Legacy from "ClawNet" branding. Has credit deduction system (~200 lines of real logic), OAuth signup, WebAuthn, early social/economy stubs. Being retired.
- **Billing**: Designed but not implemented. $7.99/mo, 200 credits, 14-day trial, referral codes. Will use Stripe.

## The Architecture Decision

**All backend services consolidate into one Rust binary (`heyvera`). TypeScript only for frontends.**

Reasoning:
1. Every action touches Soma crypto (Ed25519 verify). Can't afford cross-process calls.
2. Agents generate 10-100x human traffic. Need systems-language throughput.
3. Sovereign nodes must be single-binary. Solo vibe coder downloads one file, runs it.
4. Never rewrite. Every scaled social platform (Twitter, Discord) rewrote from scripting → systems.
5. Single binary deployment eliminates container orchestration for sovereign nodes.

### Benchmark data (2026):
- Rust Actix-web: 1.5x faster than Go Gin, 20% less memory
- Rust: 15ms avg at 1K concurrent, 45ms at 10K. Go: 20ms → 60ms (gap widens)
- Rust memory: 50-80MB vs Go 100-320MB for equivalent services
- Elixir/BEAM: 50-100K req/s, excellent for massive concurrent connections but lower raw CPU
- Tauri 2.0: 96% smaller than Electron, 50% less RAM, production-ready with mobile

### Target binary structure:
```
ONE RUST BINARY: `heyvera`
├── Soma       — Identity, delegations, spend, crypto, heartbeats
├── Vera       — AI brain, memory, observation, reasoning
├── Cortex     — Orchestration, workers, routing, scheduling
├── Social     — Feed, posts, notifications, search, real-time
├── Marketplace— Listings, packages, reviews, agent-for-hire
├── Billing    — Stripe, credits, subscriptions, referrals
├── Crypto     — Token mechanics, on-chain, wallet auth
└── Shared     — SQLite (WAL), WebSockets, SSE, rate limiting, auth
```

### GitHub org structure (heyvera/):
```
heyvera/soma          — Open protocol. Rust crate + spec. Standalone, no platform deps.
heyvera/platform      — Main platform. Cargo workspace monorepo.
  ├── crates/{core,vera,cortex,social,market,billing,auth,api,worker}
  ├── apps/{cortex-web,social-web,market-web,desktop}
  ├── mobile/
  └── cli/
heyvera/soma-sdk-ts   — TypeScript SDK for third-party Soma adoption
heyvera/soma-sdk-python — Python SDK for ML/AI community
heyvera/heyvera.org   — Marketing site + docs
```

### Frontends (TypeScript/React):
- Web: cortex.heyvera.org, social.heyvera.org, market.heyvera.org
- Desktop: Tauri 2.0 (Rust backend + React webview)
- Mobile: React Native or native Swift/Kotlin
- Shell: Rust CLI
- Agent SDK: Rust + WASM for browser agents

### Database: SQLite with WAL mode
- Sovereign single-node: self-contained, no external DB dependency
- Scale path: SQLite → libSQL (Turso) for distributed, or → PostgreSQL

## Research I've Done — Challenge This

### Competitor/Adjacent Protocol Analysis:

**Bluesky AT Protocol:**
- DIDs for identity (dual: mutable domain handle + immutable DID)
- Signed data repositories (IPLD content-addressed, like Git)
- Federated via XRPC (HTTP + JSON), auth data in CBOR
- IETF Internet Draft published Sept 2025
- Personal Data Servers (PDS) host user repos
- 10M+ users by Oct 2024

**Farcaster:**
- Hybrid: on-chain identity (Optimism, Ethereum fid) + off-chain content (Hubs P2P network)
- Frames for interactive in-feed actions
- Neynar acquired protocol maintenance Jan 2026
- AI agent collaboration via Clanker acquisition

**Nostr:**
- Simplest: keypair-based identity, relay architecture
- NIP-AA proposal for autonomous agents
- Someone built VPN with Nostr keypairs, multiplayer DOOM via Nostr relay discovery
- Very minimal but extensible

**AIP (Agent Identity Protocol) — IETF draft March 2026:**
- Invocation-Bound Capability Tokens (IBCTs): fuse identity + authorization + provenance into append-only token chain
- Compact mode: JWT + Ed25519 (single-hop, 0.049ms verify in Rust)
- Chained mode: Biscuit tokens + Datalog policies (multi-hop delegation)
- Catches attack categories that unsigned/plain JWT deployments miss
- THIS IS VERY SIMILAR TO SOMA. Soma uses Ed25519 + delegation caveats + spend receipts. AIP uses Ed25519 + IBCTs + Datalog. Need to understand: should Soma adopt AIP's IETF-track format? Complement it? Compete with it? Extend it?

**W3C Verifiable Credentials 2.0:**
- Published as W3C Standard May 2025
- UCANs inherit DID complexity and suffer quadratic token bloat

**Sovereign Computing Trends:**
- EU sovereign cloud spending → $23B by 2027
- 61% of European CIOs increasing sovereign solutions in 2026
- Global sovereign AI spending projected >$100B
- Solid Protocol (Tim Berners-Lee): user-owned data in "Pods"

### Pricing model:
- $7.99/mo or $79/yr (17% discount)
- 200 orchestration credits/month
- Credit pack: 100 credits / $4.99 (never expire)
- 14-day trial, card + phone required
- Referral: 1 code, 2 options (25% off annual OR 2 free weeks)
- Sovereign economics: self-sustaining from user #1, no VC dependency

## What I Want You To Challenge

1. **Is Rust-for-everything-backend the right call?** What about Elixir/BEAM for the social layer's massive concurrent connections? Go for faster iteration on marketplace CRUD? Or is the "one binary, one language" simplicity worth the Rust iteration speed cost?

2. **Soma vs AIP vs AT Protocol identity.** Soma already exists and works. AIP just hit IETF draft. AT Protocol is gaining adoption. Should Soma adopt/extend an existing standard rather than being its own thing? What's the 10/10 interoperability play?

3. **Single binary vs microservices.** When HeyVera has millions of agents + humans, does a single binary still make sense? What's the scaling ceiling? When (if ever) should it split?

4. **SQLite for a social network.** X.com uses Manhattan (custom distributed DB). Bluesky uses per-user PDS repos. Is SQLite+WAL realistic for a social feed with millions of posts? What's the real scaling boundary?

5. **The sovereign infrastructure roadmap** (replacing Stripe, Clerk, Google). Is this realistic or overambitious? What's the right sequencing? What exists already that we should build on rather than replace?

6. **Agent-as-first-class-citizen on social.** No existing social network has truly done this. What are the unsolved problems? Spam/abuse from agents? Reputation systems? Agent-to-agent discovery?

7. **Desktop + mobile + shell + web + agent API from one codebase.** Is this realistic with Tauri + React Native? What are the real gotchas?

8. **Anything I'm missing.** Blind spots, emerging protocols, competitive threats, technical risks I haven't considered.

## How to Respond

- Research anything you need with web search before answering
- Be specific and technical, not hand-wavy
- If you think something in my plan is wrong, say so directly with evidence
- If you see a better approach, describe it concretely
- If you think something is right, confirm it and explain why
- Propose concrete alternatives where you disagree, not just "consider X"
- If this requires a back-and-forth dialogue with Claude (my other AI partner), give me a structured response I can paste back

Format your response as:
1. **Confirmed (keep as-is)** — things in the plan that are correct
2. **Challenged (reconsider)** — things that need rethinking, with specific alternatives
3. **Missing (add these)** — blind spots and additions
4. **Golden ideas** — things I haven't thought of that could be game-changing
5. **Response to paste back to Claude** — if you want to start a dialogue
