# AID-Settle — Build Plan

> Protocol 3: Trust-gated settlement + pricing optimization.
> Ships when AID-Receipt adopters want trust-gated pricing.
> Most ClawNet-specific of the three protocols.
> Split from AIDplan on March 24, 2026.

## What AID-Settle IS

Trust scores determine how you pay. Higher trust = lower price + deferred settlement.

- Settlement modes (immediate, standard, batched, deferred)
- Trust-gated pricing tiers (0% → 30% discount based on trust verdict)
- EIP-3009 receiveWithAuthorization (direct USDC, no facilitator)
- EIP-2612 permit for batched/deferred settlement
- Credit limit formula: maxCredit = min(trustScore * 0.5, 50) USDC
- Burst detection (5x spending spike = freeze deferred)
- USDC pause detection (revert to immediate during Circle pause)
- Gas price circuit breaker (pause batch at 10x 7-day average)
- X-AID-NEW onboarding (zero-auth identity + first payment in one call)
- 402 response headers (PAYMENT-REQUIRED, X-AID-TRUST-GATE, X-AID-PRICING-TIERS)

## What AID-Settle IS NOT

- Trust scoring (that's AID-Trust)
- Receipts (that's AID-Receipt)
- Credit ledger internals (that's ClawNet product — the USDC→credit bridge)

## What's Built (spec complete, partial code)

- Trust-gated pricing logic: trustGatedCreditCost() in credits.ts (production)
- Gas price circuit breaker (production)
- 402 response headers designed (CDDL in AIDplan)
- Settlement mode specs (immediate/batched/deferred) fully designed
- Credit limit formula defined
- Bust-out fraud defenses designed (5 layers)
- Permit phishing defenses designed (4 mitigations)

## What Needs to Be Built

- [ ] Direct EIP-3009 receiveWithAuthorization (no facilitator)
- [ ] EIP-2612 permit flow for batched/deferred
- [ ] USDC.paused() check before accepting deferred
- [ ] Settlement batch aggregation + multicall
- [ ] Per-agent credit limit enforcement (on-chain verify)
- [ ] Burst detection integration with settlement service
- [ ] Solana SPL USDC settlement option (Ed25519 single-key)

## Prerequisites

AID-Receipt must exist (receipts are the settlement evidence). AID-Trust must be live (scores determine settlement mode). At least 50+ agents with trust scores to make tiered pricing meaningful.

## AIDplan Source Sections

Content to extract:
- Part 2 C (C.1-C.4): Settlement modes, onboarding, heartbeat (NOT C.5 — feedback is AID-Receipt)
- Part 3 B.2-B.3: Permit phishing defense, bust-out fraud defense
- Part 3 F.7: USDC pause detector
- Part 3 F.15: Gas price circuit breaker
- Part 5 A: Economic model, gas budget, cost comparison
- Part 5 B: Credits as internal ledger (USDC→credit bridge)
