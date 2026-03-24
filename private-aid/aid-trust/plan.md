# AID-Trust — Build Plan

> Protocol 1: Trust scoring + identity + verification.
> The DIF submission. The "one npm install" protocol.
> Split from AIDplan on March 24, 2026.

## What AID-Trust IS

Five headers. One scoring formula. Merkle verification. Offline-verifiable trust scores.

- Self-certifying identity (Ed25519 did:key)
- Trust scoring formula (v1.0: 4 dimensions, v1.1: 5 dimensions)
- Merkle-anchored trust snapshots (4h cron, verifiable offline)
- Heartbeat protocol (service discovery + pricing tiers)
- Mutual authentication (X-AID-PROOF + X-AID-PROVIDER-PROOF)
- Trust tiers + verdicts (new → proceed)
- Anti-gaming mechanisms (decay, diversity, weighted reviews)
- Key rotation + GDPR erasure
- Onboarding (X-AID-NEW auto-provisioning)

## What AID-Trust IS NOT

- Receipts (that's AID-Receipt)
- Feedback endpoint (that's AID-Receipt — takes receiptId)
- Settlement modes (that's AID-Settle)
- Guardians, insurance, social graph (that's ClawNet product)

## What's Built (~80%)

- `@aidprotocol/trust-compute` on npm (v2.1.0, MIT)
- `@aidprotocol/mcp-trust` on npm (v1.1.0, one-line MCP integration)
- Middleware for Hono/Express/Fastify (`packages/middleware/`)
- Ed25519 signing + JCS + base58btc (production in ClawNet)
- Merkle tree + proof gen/verify (production)
- Offline AID verification (production)
- AID registration + key rotation (production)
- Trust snapshots 4h cron (production)
- Heartbeat endpoint (production)
- Trust-gated pricing logic (production)
- Public trust API — GET /v1/aid/:did/trust (production)
- Pedersen commitment privacy option (production)
- Protocol-level canary (production)
- Trust score explanation API (production)
- /.well-known/aid.json + aid-platform-key (production)

## What's Left to Build

- [ ] Deterministic arithmetic spec (Opus #16 — CRITICAL for DIF)
- [ ] Standalone threat model document (Opus #15 — extract from AIDplan)
- [ ] KERI compatibility note (Opus #10 — spec note, zero code)
- [ ] ACDC interop note (Opus #11)
- [ ] RFC 9421 HTTP Message Signatures alignment
- [ ] E2E scenario conformance tests (Opus #18)
- [ ] Profile registry governance (Opus #17)
- [ ] Run against external harnesses (msaleme, rsbasic, AIWG)

## What's Left to Ship (DIF Submission)

- [ ] Submit AID-Trust to DIF TAAWG as focused spec
- [ ] Get 1 external MCP server operator running mcp-trust
- [ ] Rewrite DIF slides to match what's actually built
- [ ] Submit NIST NCCoE comment (deadline April 2)

## AIDplan Source Sections

Content to extract from AIDplan:
- Part 2 A (A.1-A.10): Identity + trust scoring + mutual auth
- Part 2 D (D.1-D.8): Formal definitions (ABNF, CDDL, signing, errors, conformance)
- Part 3 A: Threat model + attack vectors (trust-relevant subset)
- Part 3 B: Anti-gaming defenses
- Part 3 E: MCP ecosystem security
- Part 3 F: Infrastructure security
