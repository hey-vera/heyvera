# Heart as Billing Spine — Core Architectural Commitment

Status: **backlog / architectural principle** — carries forward from Soma 1.1 and is formalized in 1.2.
Opened: 2026-04-10
Related: `soma-1-2-scope.md`, `moat-compounding-thesis.md`, `soma-horizon.md` §2.6 (Agent OS Kernel), `heydata-clawapis-soma-pitch.md` §3 (x402 spend gating)

## The commitment

Heart is the runtime through which every agent I/O flows — HTTP, storage, payment, tool invocation. This is already the stated design direction in `soma-horizon.md` §2.6 ("Soma as Agent OS Kernel") and is implicit in the HeyDATA pitch where every x402 payment goes through the user's heart as the delegation issuer. This doc formalizes that commitment as a core architectural invariant and documents its revenue consequences.

**The invariant:** every payment a reference `@soma/heart` runtime signs is a metered payment. Metering is a default behavior of the reference runtime, not an opt-in feature. Forking the runtime to disable metering is permitted by open-source license but produces hearts that are flagged as unmetered in receipts and excluded from the canonical registry.

## Why metering at the heart layer, not at the registry

Three reasons the spine sits at sign-time, not at discovery-time:

**Universal surface.** Every agent payment touches a heart at sign. Only some payments touch a registry (for verifier discovery). Metering at the heart captures 10-100x the addressable volume.

**Harder to bypass.** The registry can be replaced with a custom index trivially. The heart runtime is the kernel — replacing it requires maintaining a fork against every Soma version bump, shipping alternative reference integrations, and convincing every downstream SDK consumer to trust the fork. The maintenance tax dwarfs the fee savings at any reasonable rate.

**Policy co-location.** The heart is already the place where caveats are enforced (step-up, budget, host-allowlist, command-allowlist, time-window). Metering at the same layer means fee insertion and policy evaluation happen in the same sign-time hook, which is cleaner architecturally and avoids a separate metering pass.

## Rate discipline

The spine only works if the rate is structurally invisible. My calibration target: **metering should be low enough that nobody builds a bypass specifically to avoid it.** Concretely:

- L1 base: 5 bps, floor 1 bp, ceiling 10 bps.
- At 5 bps on a $0.01 Soma Check call = $0.0000005 (dust, rounds to zero).
- At 5 bps on a $1 LLM call = $0.0005 (noise).
- At 5 bps on a $100 tool invocation = $0.05 (meaningful but below any comfort threshold).
- At 5 bps on $10M daily aggregate ecosystem volume = $5K/day = $1.8M/year.
- At 5 bps on $1B daily = $500K/day = $182M/year.

This is Chainlink CCIP territory (6.3 bps for LINK messaging). It is an order of magnitude below Stripe. It is calibrated to compound, not to extract.

## What "reference heart" means operationally

A reference heart is a `@soma/heart` instance whose metering module is at the canonical version, whose outcome log head is publicly gossipable, and whose sign-time hooks conform to the current `soma-capabilities` spec. Operationally, this is enforced by a published `ReferenceHeartAttestation` schema — any heart can self-attest that it meets the current reference requirements, and observers (including the canonical registry) can verify the attestation against the spec version.

Non-reference hearts (forks, custom implementations, debug builds) can still sign payments and participate in the ecosystem, but they:

- Are not eligible for the canonical registry's verified-heart list.
- Produce receipts flagged `heart-reference: unverified`.
- Are excluded from the reputation aggregator's trust score weighting until they re-attest.
- Cannot earn heart-operator emissions.

This is a soft exclusion. Hard exclusion would break open-source values. Soft exclusion creates natural pressure to stay on the canonical path without forcing it.

## Chain neutrality

The metering layer is chain-agnostic. Heart signs payment intents in a canonical envelope format that works for x402 on Base, x402 on Solana, x402 on any EVM L2, and any future payment rail that plugs into the heart's payment client. The metering fee is inserted into the signed envelope before settlement, and the settlement layer routes the fee portion to the protocol treasury on whichever chain the payment settled. Treasury aggregates across chains.

This means a fork of Soma to a new chain does not break metering. It also means the protocol is not dependent on Base, Solana, or any single rail's continued health.

## Post-quantum readiness

Metering attestations should use hybrid ML-DSA signatures from day one. The Receipt Layer plan already has a PQ migration path; the metering format should be designed on the PQ side of that migration so the fee infrastructure never needs to be rewritten for PQ compliance. This is a 2026 architectural choice with negligible cost now and high cost later.

## ZK migration path

Current design: metering attestations are plaintext and reveal the paying heart, the counterparty, and the amount. Future version: metering proofs use ZK to prove "fee was paid per protocol" without revealing transaction details. This is not needed at launch — plaintext is fine for Year 1-2 — but the envelope format should be designed so ZK is a migration, not a rewrite. Specifically, the metering hook should produce a commitment that can later be replaced with a ZK proof over the same predicate.

## Cross-protocol abstraction

Metering is defined at the heart-sign layer, which sits one layer above the payment rail. This means Soma metering works uniformly whether the outer payment is x402, Stripe MPP, Google AP2, Visa TAP, L402, or a protocol that doesn't exist yet. The heart signs a payment intent; the metering hook runs; the payment rail then handles settlement. If Soma becomes the trust layer referenced by A2A or other ecosystems, metering flows through unchanged.

## Governance constraints

The spine is load-bearing, so governance cannot dismantle it. Constitutional constraints hardcoded at the protocol level:

- L1 base floor (1 bp) and ceiling (10 bps) cannot be changed without a supermajority + 90-day time-lock.
- Treasury allocation minimums (25% grants, 10% insurance reserve) cannot be reduced by governance.
- **L7.5 public-goods disputer pool allocation** (added 2026-04-11 per `soma-1-2-scope.md` D4): the non-governable % of L5 trust-product fees routed to the permissionless disputer role cannot be reduced or rerouted by governance. This is the circuit breaker against buyer-verifier collusion and is mandatory — see `soma-1-2-adversarial-pressure-test.md` Perspective 1 for why optionality here is fatal.
- Metering-enabled requirement for "reference heart" status cannot be waived except by a supermajority + 90-day time-lock.
- Founder/team token allocation cannot exceed protocol-defined cap.
- Emergency multi-sig authority has a sunset clause and can only freeze operations, not redirect funds.

This is the Maker/Compound/Aave pattern adapted for protocol revenue. Institutional investors and insurance integrations require these constraints before they'll participate.

## Relationship to existing fee model

The existing `project_fee_model.md` memory frames the fee model as "free routing, paid trust queries only." That framing is correct for the pre-spine era when the billing point was ClawNet-the-product and the only paid surface was trust queries. With heart as runtime, the billing point moves to the heart-sign layer and the paid surface expands to every metered payment. The existing trust query fees (L3) are preserved unchanged and become one layer of the seven-layer stack rather than the entirety of the revenue model.

The token design in `project_fee_model.md` is compatible and extends naturally: trust gas burning, revenue buy-and-burn, burn-for-credits discount, functional-benefits-only staking — all preserved, all extended by the metering surface. The only change is that revenue sources multiply from "trust queries" to the seven-layer stack.

## When this doc becomes build work

This doc is an architectural principle, not a build spec. Build specs are in `soma-1-2-scope.md` (L1 metering primitive lives in Phase B; `@soma/metering-client` lives in Phase C) and `gameplan-post-1-1.md` (updated sequencing).

The first code for this commitment is `src/heart/metering.ts` in the Soma repo, built alongside the accountability primitives in Phase B. Until then this doc is the source of truth for the invariant.
