# GitHub Issue Draft: x402 `agent-trust` Extension Proposal

**Title:** [Extension Proposal] `agent-trust` — DID-based identity and trust scoring for x402 payments

**Labels:** extension, proposal

---

## Problem

x402 enables agent-to-agent payments, but the paying agent is currently just a wallet address. There's no standard way for agents to:

1. Prove their identity beyond a wallet signature
2. Assess counterparty trustworthiness before paying
3. Get trust-based pricing (discounts for reliable agents)
4. Verify the server is who it claims to be (mutual auth)

This matters because as agent commerce scales, agents need to make trust decisions about counterparties they've never interacted with before — especially when real money is involved.

## Proposed Solution

A new `agent-trust` extension that adds optional DID-based identity proofs and trust score exchange to x402 flows:

- **`PaymentRequired`**: Server advertises its DID, minimum trust score, pricing tiers, and a trust verification endpoint
- **`PaymentPayload`**: Client includes its `did:key`, a signed proof (Ed25519), timestamp, and nonce
- **`SettlementResponse`**: Server returns its own proof (mutual auth), the client's resolved trust score, and a receipt ID

Trust scores are 0-100 integers computed from behavioral signals (success rate, latency, uptime), attestation signals (counterparty feedback), and manifest adherence. The scoring algorithm is deterministic — any party can independently verify.

## Key Design Decisions

- **DID-based, not wallet-based** — decouples identity from payment mechanism. A `did:key` is transport-agnostic (works on EVM, Solana, or no chain at all).
- **Optional and backwards-compatible** — servers that don't support it omit the extension. Clients that don't support it pay normally.
- **Complements `reputation` extension** — `reputation` (#1024) handles on-chain proof-of-service via ERC-8004. `agent-trust` handles transport-layer identity and pre-payment trust assessment. They compose: an agent can have both.
- **Crypto-agile** — Ed25519 today, ML-DSA (post-quantum) tomorrow, no protocol change needed.

## Prior Art / Related

**x402 repo:**
- #1024 — `reputation` extension (ERC-8004 based, on-chain proof-of-service)
- #931 — ERC-8004 reputation support discussion
- #1707 — `sworn-trust` extension (trust-gated pricing)
- #1277 — Identity & Reputation Layer proposal
- #1375 — Cold-start trust mitigation patterns

**Ecosystem projects doing identity + trust:**
- **DJD AgentScore** — 0-100 trust score from x402 settlement history (5 dimensions). Simple aggregation, no divergence detection or anti-collusion.
- **MoltGuard** — 0-100 scoring, Sybil detection via funding cluster analysis, Ed25519 VCs, ERC-8004 integrated. Closest to this proposal but product-specific, not a protocol spec.
- **Cascade/SATI** — Trust infrastructure on Solana (identity + reputation + validation). Chain-specific, no transport-layer standard.
- **ACK (Agent Commerce Kit)** — W3C DIDs/VCs for agent identity with x402. DID-based like this proposal but no behavioral trust scoring.
- **ScoutScore** — Service health monitoring (uptime, response fidelity). Overlaps with reliability signals but not a trust protocol.

**What `agent-trust` adds beyond these:**
- Manifest-attestation divergence detection (does the agent do what it claims?)
- Anti-collusion framework (clique detection, burst detection, reciprocity analysis)
- Deterministic scoring algorithm (any party can independently verify)
- Crypto-agility (Ed25519 → ML-DSA post-quantum migration without protocol change)
- Formal spec with standards-body engagement (DIF TAAWG, NIST NCCoE)
- Mutual authentication (both client and server prove identity)

This proposal aligns with the [x402 roadmap's request](https://github.com/coinbase/x402) for "Identity Solution Proposals (guides/PRs using existing identity providers)."

## Production Evidence

Running in production on [ClawNet](https://claw-net.org) (344 API endpoints, skill marketplace, x402 payments):

- Trust-gated pricing: 6 tiers based on trust score (0-15% discount)
- Mutual authentication on x402 responses
- Nonce replay protection with 5-minute window
- Published package: [`@aidprotocol/trust-compute`](https://www.npmjs.com/package/@aidprotocol/trust-compute) v2.0.0 (MIT, standalone, zero ClawNet dependencies)
- On-chain identity: ERC-8004 Agent ID 36118 (Base)

## Next Steps

If there's interest, I'll submit a spec PR at `specs/extensions/agent-trust.md` following the extension pattern, then a TypeScript implementation.

Full spec draft: [aid-x402-trust-extension.md](https://github.com/aidprotocol/aid-spec/blob/main/spec/profiles/aid-x402-trust-extension.md)
