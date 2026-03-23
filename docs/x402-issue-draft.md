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

- #1024 — `reputation` extension (ERC-8004 based, on-chain)
- #931 — ERC-8004 reputation support discussion
- #1707 — `sworn-trust` extension
- #1277 — Identity & Reputation Layer proposal
- #1375 — Cold-start trust mitigation patterns

## Production Evidence

This has been running in production on [ClawNet](https://claw-net.org) (344 API endpoints, skill marketplace, x402 payments) since March 2026:

- Trust-gated pricing: 6 tiers based on trust score (0-15% discount)
- Mutual authentication on every x402 response
- Nonce replay protection with 5-minute window
- Published packages: `@aidprotocol/trust-compute` (MIT), `@aidprotocol/x402-enhanced` (Apache 2.0)
- On-chain identity: ERC-8004 Agent ID 36118 (Base)

## Next Steps

If there's interest, I'll submit a spec PR at `specs/extensions/agent-trust.md` following the extension pattern, then a TypeScript implementation.

Full spec draft: [x402-agent-trust-extension.md](https://github.com/1xmint/claw-net/blob/main/docs/x402-agent-trust-extension.md)
