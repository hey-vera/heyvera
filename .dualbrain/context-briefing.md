# HeyVera Context Briefing for GPT 5.5 Deep Analysis

## What HeyVera Is
A sovereign living network where agents and humans are first-class citizens. Not a web app with AI features — a high-throughput cryptographic real-time platform. Agents will generate 10-100x the traffic of humans.

## The Layers

### Soma (the heart) — Open Trust Protocol
- Identity via did:key (Ed25519 keypairs)
- Delegations: scoped agent-to-agent trust chains with caveats (time-bound, action-scoped, spend-capped)
- Spend receipts: cryptographic proof that computation/payment occurred
- Heartbeat chains: liveness proofs — append-only chain proving an agent is alive and active
- Signs actions across ALL protocols (AT Protocol, MCP, A2A, ActivityPub)
- NOT a competing social protocol — adds cryptographic trust to existing ones
- Key differentiator: Soma Check = conditional payment via content-addressed hashing (x402 ETag)
- Proof-of-Trust-Work: 4-layer defense (VRF selection, committed inputs, ZK-verified computation via Nova IVC, economic security)
- Status: Rust implementation live, delegation v0.1 shipped, integrated into Cortex

### VeraAI (the observer) — Decentralized Intelligence
- Distributed intelligence emerging from sovereign compute nodes
- Thousands of humans each running their own node with their own computational power
- Users vibe-code with their AI agent (Cortex) — every prompt, process step, response is data
- VeraAI learns from it all, intelligence flows back to everyone
- Users opt in because Soma proves no data leaking — intelligence flows back as improved routing, better intent parsing, shared patterns
- ObservationEnvelope: content-addressed, Soma-signed immutable provenance wrapper
- EvaluationReceipt: separate linked DAG (evals never mutate observations)
- The long-term moat: you can fork code, you can't fork collective intelligence from 10K nodes
- Status: planning/design phase, Cortex is the first node

### Cortex (orchestration brain) — First Surface to Ship
- Multi-provider AI orchestration engine. One chat, many brains.
- Lightweight deterministic routing engine (NOT an LLM) + thin conversation agent (Haiku-class)
- Routes tasks across Claude, GPT, Gemini based on: task shape, risk level, provider capacity, outcome history
- Workers run in user environments (containers, local machines) — Cortex never executes code
- WebSocket coordination protocol between Brain and Workers
- Learning: Bayesian provider profiles, Thompson sampling, contextual bandits for weight selection
- Self-modifying execution DAGs, shared working memory between agents, fleet intelligence
- Status: working locally, Rust backend on :3001, React frontend on :5001, chat works

### Other Surfaces (planned)
- Social: alternative to X.com for agents AND humans (feed, posts, communities, auto-post agents)
- Marketplace: agents for hire, software packages for sale, escrow, reviews
- Crypto: Soma-provenant token launch, wallet auth
- Hosting: sovereign agent hosting, resource metering
- Data APIs: x402-gated data services
- Billing: subscriptions + x402 micropayments

## Billing Model (DECIDED)
- $7.99/mo subscription = unlimited human access (compute cost negligible — Rust efficiency + layered intent pipeline means ~$0.13-0.15/user/month)
- x402 micropayments = per-call for agent/API access
- Credits/metering dropped for subscription tier
- Stripe for payment processing now, sovereign rails later
- USDC-only for x402 v1, no token yet

## Technical Stack (DECIDED)
- All-Rust backend, single binary with feature flags per surface
- Axum HTTP server, Tokio async runtime, sqlx for DB
- Protocol crates: no_std + alloc for WASM portability
- Event sourcing for protocol data (Soma events, observations, trust proofs)
- CRUD for admin/settings/user data
- CBOR/DAG-CBOR for canonical content-addressed objects
- JSON/protobuf for service APIs
- Frontend: React (Vite for now, Next.js long-term for SSR on social/marketplace)
- Auth: Clerk for humans, Soma for agents

## 4-Layer Intent Pipeline (DECIDED)
- Layer 1 (~70%): Deterministic regex/keyword pattern matching. Zero LLM cost.
- Layer 2 (~25%): Embedding similarity search. Local ONNX model.
- Layer 3 (~4.9%): Small constrained LLM (GPT-4.1-mini/Haiku or local Phi-3).
- Layer 4 (~0.1%): Frontier model (Claude Opus/GPT-5). Only for ambiguous queries.

## Key Principles
- Go slow, build solid. Foundation-first. Always the long-term 10/10 choice.
- Sovereign-first: every node is self-contained, one binary, runs anywhere.
- Agents are citizens: architecture assumes agent traffic 10-100x human traffic.
- Deterministic where possible, LLM only where necessary.
- Build once in Rust — code written today handles the millionth user.
- Log everything — telemetry schema is the hardest thing to change.
