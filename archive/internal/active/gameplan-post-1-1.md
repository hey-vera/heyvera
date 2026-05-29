# Gameplan — Post Soma 1.1

Status: **active** — current sequencing plan after shipping Soma 1.1 step-up + caveats.
Opened: 2026-04-10
Updated: 2026-04-10 — added metering primitive to Phase B, metering client to Phase C, reflecting heart-as-billing-spine commitment
Related: `../backlog/secret-scanner.md`, `../backlog/trust-accountability-teeth.md`, `../backlog/soma-1-2-scope.md`, `../backlog/wallet-rotation-architecture.md`, `../backlog/heart-billing-spine.md`, `../backlog/moat-compounding-thesis.md`, `../backlog/heydata-clawapis-soma-pitch.md`

## Where we are

- Soma 1.1 shipped: factor registry, step-up service, tier ladder, 4 new caveats (`requires-stepup`, `host-allowlist`, `command-allowlist`, `time-window`), full vitest coverage (582 tests green), spec bumped, committed, pushed.
- HeyDATA/ClawAPIs/Nova identified as the first external client target (see `heydata-clawapis-soma-pitch.md`).
- Accountability gap identified: nothing in 1.1 reduces an agent's trust when they do bad work.
- Buyer-paid verification market identified as the cleanest accountability mechanism.
- Wallet rotation identified as the right way to harden long-lived EVM keys across all heart deployments.
- Secret scanner motivated by an actual leak caught during the 1.1 session.

## Sequencing

The order matters. Each step gates or enables the next.

### Phase A — Safety net (days)

1. **`@soma/secret-scanner`** (`../backlog/secret-scanner.md`). Ship first. Tiny, high-signal, prevents the next leak while we build everything else. Install hook in soma, claw-net, all heart-consuming repos.
2. **Pending cleanup**: rotate leaked `cn-59bf...` API key in ClawNet `api_keys`. Clean `SOMA-DELEGATION-SPEC.md` trailing terminal dump. Both blocked on operator action; do not proceed past Phase A until done.

### Phase B — Accountability primitives + metering spine (1–2 weeks)

3. **`src/heart/reception-receipt.ts`** — types, canonical signing, verification.
4. **`src/heart/outcome-log.ts`** — append-only hash-chained log mirroring `revocation-log.ts`.
5. **`src/heart/reputation-aggregator.ts`** — pure deterministic score function, fully tested.
6. **`src/heart/verifier-registry.ts`** — trusted verifiers per capability class.
7. **`src/heart/metering.ts`** — billing spine primitive. Sign-time metering hook that inserts L1 base fee (5 bps, floor 1, ceiling 10) into every signed payment envelope. Chain-agnostic. Hybrid ML-DSA signed. ZK-ready envelope format. See `../backlog/heart-billing-spine.md` for the invariant this enforces.
8. **`src/heart/reference-attestation.ts`** — `ReferenceHeartAttestation` schema + verifier. Marks a heart as reference-compliant for registry eligibility.
9. **New caveats in `delegation.ts`**: `requires-verification`, `min-trust-score`, `max-recent-failures`.
10. **Spec bump to `soma-capabilities/1.2`** with full documentation of metering envelope, seven-layer fee stack, reference heart criteria.

### Phase C — Verification market packages + metering client (1 week)

11. **`@soma/verification-client`** — buyer-side helper to trigger verification, collect receipts, append to outcome log. Invokes L2 verification routing premium when registry-discovered.
12. **`@soma/verifier-sdk`** — verifier-side helper to validate requests, run domain checks, sign and return receipts. Includes staking registration and slashing dispute hooks.
13. **`@soma/metering-client`** — standalone metering client that reference hearts embed, plus a standalone CLI for verifying metering attestations from receipts.
14. **Nova reference verifier** for `tool:verify:x402-response-integrity` — smallest credible domain, closest to existing Soma Check.

### Phase D — Wallet rotation (2 weeks)

15. **`src/heart/wallet-rotation.ts`** core abstraction, policy engine, `WalletRotationController`, append-only rotation log.
16. **In-memory mock backend + full test suite** — rotation cadence, panic rotate, replay resistance, log tamper, freeze.
17. **`@soma/evm-backend`** — EIP-7702 delegation, Zerodev Kernel / Safe ERC-7579 session key module, FROST threshold signing for bootstrap key, EAS anchoring of rotation log heads.
18. **Wire into ClawNet** as first production deployment of rotation.

### Phase E — Week 2 packaging (parked from earlier plan)

19. `@soma/heart` npm publish (one-line boot with metering on by default).
20. `@soma/stepup-webauthn` — iOS platform passkey verifier.
21. `@soma/stepup-pwa` — browser approval UI.
22. `@soma/receipts` — EAS-anchored receipt explorer + hosted instance. Surfaces metering attestations alongside birth certs.
23. Reference integration doc: "Nova runs a Soma heart in production, under 300 lines."

### Phase F — First production test (ongoing from Phase D)

24. ClawNet runs a reference heart in production with metering + rotation + 1.2 primitives active.
25. Nova runs a reference heart + acts as first reference verifier.
26. Test agent flow: Alice delegates work to Bob with `requires-verification` pointing at Nova. Happy path and sad path walkthroughs from `trust-accountability-teeth.md` exercised on real infra.
27. One public demo video of full voice → watch approval → signed receipt loop (Soma 1.1) and one of the accountability sad path (Soma 1.2).
28. Kill-metric checkpoint at 18 months from 1.2 launch: validate >100 reference hearts in production and >$1M/month metered x402 volume. If not met, pivot per `moat-compounding-thesis.md`.

### Phase G — HeyDATA outreach (only after F)

29. Reach out to HeyDATA / ClawAPIs team. See trigger conditions in `../backlog/heydata-clawapis-soma-pitch.md` — do not reach out before Phase F is complete.

### Phase H — Institutional integrations (Year 2+)

30. EU regulatory outreach — offer outcome log aggregator as reference AI Act compliance tool.
31. L7 compliance report product — priced per-report / per-enterprise-seat.
32. Insurance data licensing exploration — identify first anchor underwriter, begin actuarial validation of aggregator formulas.
33. L6 insurance data license product — Year 3 target, highest-margin stream in the stack.

## First production test — what it means

"First production test" is not a staged demo. It is **ClawNet itself running the full Soma 1.2 stack in production, dogfooding every primitive**, with Nova as the independent verifier and every action creating real receipts, real outcome log entries, real rotation events on EAS.

Metrics we want to observe during the first production test:

- Rotation works on schedule without human intervention for 30+ consecutive days.
- At least one panic-rotate event is triggered (intentionally, as a drill) and completes without signing downtime beyond the expected freeze window.
- At least one bad-work scenario is caught by Nova verification and propagates to a trust-score drop and a gated delegation rejection.
- No secret-scanner bypass events; no committed secrets.
- Outcome log is independently verifiable by a third-party replay of the aggregator formula.

## Hard constraint throughout all phases

**Soma is open source.** Every line of code, every protocol decision, every key derivation scheme must survive public review. No mechanism that depends on secrecy of code. Every design in the backlog docs explicitly accounts for this — the invariants in `wallet-rotation-architecture.md` and the termination argument in `soma-1-2-scope.md` are both open-source-first.

## Operational pending (blocking Phase A)

- Rotate leaked `cn-59bf...` API key in ClawNet `api_keys` table (full key intentionally omitted; operator has the value).
- Clean `SOMA-DELEGATION-SPEC.md` trailing terminal paste.
- Investigate VPS SSH timeout on `24.199.121.137:22` (claw-net commit `37b9b8e` still needs to push when reachable).
