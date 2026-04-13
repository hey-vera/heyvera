# x402 `upto` + Visa-Card-Per-Agent — Brainstorm

**Status:** brainstorm / research — not a committed build.
**Opened:** 2026-04-12
**Related:**
- `backlog/heart-billing-spine.md` (chain-neutral metering invariant — already names Visa TAP)
- `backlog/proof-of-delivery-roadmap.md` (AVS / TEE / Intent tracks — upto is the settlement complement)
- `backlog/heydata-clawapis-soma-pitch.md` §3 "x402 spend gating"
- `active/x402-delegation-issue.md` (Soma Delegation as x402 extension — scoped bounded authority)
- `active/soma-check-header-spec.md` (conditional payment via content hashing)
- `active/fee-spine.md` (seven-layer fee stack)

---

## TL;DR

**Grok/user asked two questions.**

**Q1 — Is x402 `upto` legit, should we adopt it?**
Yes, it's real. Coinbase shipped it on **2026-04-10** (two days ago). The GitHub README still calls it "theoretical" because the README hasn't been updated. It replaces x402's fixed-price-only model with "authorize a max, settle for actual usage after work completes." It is the payment-layer twin of Soma Check (which already handles "pay zero if unchanged"). **Adopt, but not urgently** — wait 2–4 weeks for providers to shake out the edge cases, then integrate through the heart payment client (not the heart itself) so the existing `heart-billing-spine.md` invariant stays intact.

**Q2 — What would a Visa-card-per-agent (ClawAPIs / Steve Moraco framing) unlock for Soma trust agents?**
It's a real strategic direction, not vaporware. Visa released **Visa CLI** on **2026-03-18** and unveiled **Trusted Agent Protocol (TAP)** shortly after. Visa is already collaborating with Coinbase on x402 interoperability. The gap in Visa's stack is exactly the gap Soma already fills: TAP authenticates agents via HTTP Message Signatures but doesn't specify **how agents are bounded, scoped, rotated, or revoked.** Soma Delegation + HumanDelegation + CeremonyPolicy + CredentialRotationController are precisely those missing primitives. A Soma-backed agent Visa card is not a new product direction — it's the natural output rail for the architecture we already shipped in Soma 1.1.

**Neither of these requires new code this week.** Both belong in the Soma 1.2 / 1.3 roadmap as compatibility layers, not as rewrites.

---

## Part 1 — x402 `upto` research

### What it is (verified from multiple sources, 2026-04-10)

From CoinCentral and crypto.news coverage of Coinbase's 2026-04-10 announcement:

- **Sellers set a maximum price. Buyers authorize a spending limit per request.**
- After the work completes, **the server calculates the precise cost** based on resources consumed (token count, compute time, query complexity).
- The buyer is charged **only the final computed cost**, not the authorized ceiling.
- Targets variable-cost AI workloads — LLM generation, image synthesis, any task where pre-execution cost is not knowable.
- Launches on ERC-20 via CDP Facilitator (gasless). No on-chain commitment of the ceiling — the cap is an off-chain promise between client and server, with the facilitator doing settlement.
- No dispute/refund flow has been specified yet in public docs.

### What it is *not* (important)

- **Not** an on-chain escrow. The max-spend is not locked in a contract. Client trusts the server to charge honestly ≤ ceiling; server trusts the client's signed authorization will settle.
- **Not** a pre-payment. No money moves until after work is done.
- **Not** a dispute layer. If the server overcharges, the client's only recourse is refusing future traffic. No on-chain slashing, no refund primitive.

### Why it matters for ClawNet

ClawNet already has two payment modes that model variable cost:

1. **Orchestrated calls** (`POST /v1/orchestrate`) — LLM picks endpoints, total cost unknown until all endpoints return. Current implementation: upfront estimate + reconciliation against actual credit deduction. `deductCredit` happens post-execution.
2. **Soma Check** — free hash probe, client sends `If-Soma-Hash`, pays zero if unchanged. Binary variable cost (pay full or pay zero).

`upto` is the payment-layer primitive that makes both of these *externally expressible* to any x402 client. Today, our orchestrated flow is a ClawNet-proprietary protocol on top of a fixed-price x402. With upto, we could expose the same semantics natively to any x402-speaking agent: "authorize up to $0.50, we'll settle for what you actually used, here's the cryptographic receipt."

### Adoption analysis

| Question | Answer |
|---|---|
| Is the spec stable enough to build against? | **No, not yet.** GitHub README still says "theoretical." No dispute flow, no refund primitive, no header format in the published spec. Wait 2–4 weeks. |
| Does it replace our existing model? | **No.** Our existing `deductCredit`-post-execution flow keeps working. Upto is an optional additional surface. |
| Does it fit the heart billing spine invariant? | **Yes exactly.** `heart-billing-spine.md` is explicit: heart signs a payment intent, metering hook runs, rail handles settlement. Upto is a rail semantic — the heart doesn't care whether the rail settles exact or up-to, it only cares that the metering fee is inserted before the rail runs. |
| Where does upto integration live? | In the payment client layer (`src/core/payment-client.ts` if we build one), not in the heart. The heart stays scheme-agnostic. |
| Is there a risk of early adoption? | **Moderate.** If Coinbase changes the header format or settlement semantics in the first month, we rewrite. Mitigation: wait for ≥ 3 non-Coinbase providers to ship upto before we invest. |
| Does this unlock new revenue for us? | **Marginally, today.** ClawNet endpoints with variable cost (LLM, code execution) could expose upto natively. More important: **it unlocks a cleaner Soma Check narrative** — Soma Check becomes "the zero-cost lower bound of the upto curve" instead of a standalone protocol. |

### Recommendation — x402 upto

1. **Wait 2–4 weeks** for the spec to stabilize and for ≥ 2 reference provider implementations to surface in the wild.
2. Add a `backlog/x402-upto-integration-plan.md` with the eventual integration shape: upto client in `src/core/payment-client.ts`, upto server in endpoint wrapper, no heart changes.
3. When we ship it, frame Soma Check publicly as "the zero-payment lower bound of x402 upto" — this grafts our primitive onto the larger protocol's vocabulary and gets free distribution from anyone who understands upto.
4. **Do not** rewrite existing orchestrated call logic to use upto internally. That's a rewrite, not an adoption. Keep the internal model; add upto as an external surface.

### Risks to flag

- **Off-chain ceiling = off-chain trust.** If we expose upto on our endpoints, we need our own policy for what happens when a caller's authorized ceiling is honored but the server's computed cost exceeds what we'd normally charge. The heart should enforce the ceiling as a hard cap in metering regardless of what the settlement layer accepts — otherwise a bug in the provider can silently overcharge through the full authorized amount.
- **Facilitator dependency.** CDP Facilitator is Coinbase infra. If we route all upto settlement through it, we inherit Coinbase uptime. The heart billing spine is supposed to be rail-neutral; upto-via-Coinbase is rail-coupled until alternative facilitators ship.
- **Metering visibility.** The metering fee should be inserted into the *authorized ceiling*, not the *final charge*. Otherwise a $100 ceiling with $1 actual cost would skip the metering tax on the $99 that was never charged. This is a subtle accounting decision.

---

## Part 2 — Visa card per agent + Soma research

### What Visa has actually shipped (verified, 2026)

- **2026-03-18 — Visa CLI.** Experimental command-line tool from Visa Crypto Labs. Lets AI agents initiate card payments directly from a shell without embedded API keys. Integrates programmatic card transactions. Targets "agent as economic actor" framing.
- **Visa Intelligent Commerce platform.** Visa's umbrella product for AI agents browsing, selecting, and paying for goods autonomously.
- **Trusted Agent Protocol (TAP).** Visa's framework for agent-merchant communication during transactions. Uses HTTP Message Signatures for agent authentication (per Cloudflare VP Will Allen). Collaborates with Coinbase on x402 interoperability.
- **Status:** "stage set for mainstream adoption in 2026." Visa is doing the protocol work now; dedicated AI-agent card products are not yet announced.

### What Visa has *not* specified

- How agents are issued credentials (is it Visa? merchant? third party?)
- How agent identity is bound to a human KYC anchor
- How agent permissions are scoped per transaction
- How compromised agents are rotated or revoked
- How a card is bound to an agent DID cryptographically
- What happens when an agent's delegation expires or is cascade-revoked
- Any dispute or refund semantics specific to agentic commerce

**Every gap on that list is a Soma primitive we already built.**

### The strategic fit (this is the real insight)

Soma's architecture, as of the work that just shipped in this session:

| Soma primitive | What it does | What Visa TAP is missing |
|---|---|---|
| `HumanDelegation` | Binds an agent's ephemeral DID to a human durable DID under a signed capability envelope | KYC anchor — human verified once, all agents inherit |
| `CeremonyPolicy` | Maps action classes (read/write/spend/deploy/admin) to tier requirements | Step-up logic at point of sale |
| `Delegation` with caveats | `budget`, `host-allowlist`, `time-window`, `requires-stepup`, `command-allowlist` | Merchant-category controls, spend caps, time windows — all 1:1 mappable to card-level rules |
| `CredentialRotationController` | KERI pre-rotation, L1/L2/L3 layered verification, challenge-period gating | Card rotation / compromised card replacement |
| `RevocationLog` + cascade revoke | Parent revocation kills entire subtree | Revoking a human deactivates every session card |
| Heartbeat chain + birth certs | Every action is chained and signed | Audit trail / compliance evidence |
| Receipt Layer (planned) | EAS-anchored signed receipts on Base | Real-world transaction evidence, regulator-grade |

The three-legged stool is:

```
            Visa TAP (auth wrapper)
                    |
                    v
            x402 upto (settlement)
                    |
                    v
            Soma (scoped authority)
```

**Nobody else has the third leg.** TAP says "here's how an agent proves it's an agent." x402 upto says "here's how an agent pays after work is done." Soma says "here's how that agent was bounded, rotated, revoked, and ceremony-gated." Without Soma, TAP is a signature without semantics and upto is a payment without limits.

### The "agent Visa card" concept — what it actually is

**Not** "Visa issues a physical card to an AI." That's never going to pass KYC.

**Yes** "a virtual Visa card is the point-of-sale manifestation of a HumanDelegation." Concretely:

1. Human opens a Soma session via ceremony (L2+ for spend). `HumanDelegation` signed with caveats:
   - `budget: credits=$500`
   - `time-window: 9:00-17:00 UTC`
   - `host-allowlist: [aws.amazon.com, stripe.com, openai.com]` → mapped to merchant categories
   - `requires-stepup: minTier=2, maxAgeMs=3600000` for any individual transaction > $100
   - `expires-at: now + 4 hours`
2. Session opens. A virtual Visa card is provisioned bound to this session. Card carries:
   - A short-lived PAN tied to the session ID
   - Spend limit = the session's budget caveat
   - Merchant category allowlist = the host-allowlist translated through a merchant-category map
   - Expiry = the session's expires-at
3. Agent operates. Every Visa transaction goes through TAP's HTTP Message Signature auth (the signing key is the agent's ephemeral session key). Soma enforces caveats as sign-time checks; TAP enforces them at Visa's ingress; merchant sees a signed agent identity; Visa sees a valid card.
4. Step-up triggers force a ceremony before the transaction commits. Apple Watch haptic, Face ID, signed attestation, then Visa authorizes. This is the HeyDATA pattern from `heydata-clawapis-soma-pitch.md` §3.4 applied to real-world purchases.
5. Session ends (expiry, budget exhausted, human revocation, compromise detected). Card is revoked at Visa + session is marked terminal at Soma + cascade revoke fires through any sub-delegations. Heartbeat chain records the full lifecycle.

**The card is a session handle with legs in the real economy.**

### What this unlocks for Soma specifically

1. **A concrete use case for CredentialRotationController beyond crypto keys.** Card rotation is the killer app for the rotation primitive that nobody else has built.
2. **A real-world receipt stream for the Receipt Layer.** Visa transaction → EAS attestation → permanent signed record. This is compliance-grade evidence.
3. **Volume for the billing spine.** Every TAP-routed transaction is a heart-signed payment intent. Heart metering fee (5 bps per `heart-billing-spine.md`) captures the flow. This scales dramatically if TAP adoption grows.
4. **KYC bridge without compromising agent sovereignty.** Visa trusts the human (standard KYC). Soma binds the agent to the human (HumanDelegation). Agent gets real-world spend power without Visa needing to KYC the agent itself.
5. **A moat that competes with nobody in our peer set.** ClawAPIs doesn't have scoped delegation. OpenClaw doesn't have ceremony primitives. Nevermined doesn't have credential rotation. Coinbase Agentic Wallets don't have human-bound session semantics. Soma is the only project with all the primitives that TAP needs but didn't build.

### What ClawNet could actually do about this

Short-term (next 4 weeks): **nothing concrete.** TAP is Visa's protocol. We don't own it. We cannot ship a Visa card integration without a partnership.

Medium-term (Soma 1.3, ~6–12 weeks out): **build a TAP compatibility layer in `soma-heart`.**

- `src/heart/tap-transport.ts` — HTTP Message Signature signer that emits TAP-compliant request signatures using the existing heart signing key.
- Heart's existing caveats compile to TAP's transaction-time policy headers (wherever TAP's policy format lives — still TBD).
- This makes any Soma heart "TAP-compatible by construction." When TAP launches publicly and merchants start accepting it, we're already wire-compatible with zero additional work.

Long-term (2026 H2 or later): **partner pitch.** Once the TAP compatibility layer is shipped and we can demo "heart signs a TAP-compliant HTTP Message Signature from a bounded Soma session," the pitch to Visa / Coinbase / Nevermined is concrete:

> *"TAP says the agent is signing. x402 upto says the work is done. Soma says how much the agent was allowed to spend, for how long, in which merchant categories, under which human's consent. Without Soma, TAP has no scope and upto has no cap. We are the primitive your stack is missing."*

This is the same positioning as `proof-of-delivery-roadmap.md` for EigenLayer AVS — Soma as the trust primitive that sits beneath other people's payment rails. The difference is TAP is a much bigger rail with much bigger distribution than any crypto-native option.

### Risks to flag

- **Visa doesn't need us.** Visa has its own identity stack, its own fraud stack, and can absolutely build scoped delegation internally if it wants to. The window is "while TAP is new and the scope-semantics gap is visible." If we wait, Visa builds its own version and we're competing against the card network.
- **KYC surface.** The human side of a HumanDelegation in the TAP context means that human's identity is the card holder. Soma has not previously needed to handle KYC; adding this as a compatibility surface pulls us into a regulatory surface we haven't scoped.
- **Chargeback semantics.** Visa has chargebacks. x402 upto has no dispute layer. If an agent transaction is disputed, what does Soma do? The heartbeat chain is evidence but not resolution. This is a new surface with no precedent in our stack.
- **Revocation latency.** TAP and Visa operate at card-network speeds (milliseconds). Soma's revocation is heartbeat-chain-speed (seconds, with EAS anchoring at block-speed). We need to think about how revocation propagates to Visa's authorization layer fast enough that a revoked agent can't burn the rest of the session before the revocation lands.
- **Vendor dependency.** "Soma as the trust layer under Visa TAP" sounds great until Visa changes TAP. Our TAP compatibility layer is a maintenance burden we'd take on forever.

---

## Part 3 — Recommendations

### x402 upto

1. **Wait 2–4 weeks** (target 2026-04-26 to 2026-05-10) before any implementation work. Spec needs to stabilize.
2. **Monitor the x402 GitHub repo** for header spec and reference implementation commits. Watch for second-party providers shipping upto support.
3. **When ready, create `backlog/x402-upto-integration-plan.md`** with:
   - Client changes in `src/core/payment-client.ts` (or create one if we don't have it)
   - Server changes in the endpoint wrapper (expose upto as an optional surface on variable-cost endpoints)
   - Heart metering inserts tax into the **authorized ceiling**, not the final charge — so metering captures full potential cost
   - Hard cap enforcement at the heart layer — cannot trust the remote server to honor the ceiling
   - Ring-fence CDP Facilitator dependency so an alternative facilitator can swap in later
4. **Public framing:** once integrated, position Soma Check as "the zero-payment lower bound of the x402 upto curve." This grafts our primitive onto the larger protocol's vocabulary and rides the distribution wave.
5. **Do not** rewrite existing orchestrated call logic to use upto internally. Keep the internal model. Add upto as an optional external surface.

### Visa-card-per-agent / TAP

1. **Nothing shipped this week.** This is not Soma 1.2 scope.
2. **Add to `soma-1-2-scope.md` or `soma-horizon.md`** as a Soma 1.3 track: "TAP compatibility layer in `soma-heart`."
3. **When ready, build `src/heart/tap-transport.ts`** as a thin compatibility layer:
   - HTTP Message Signature signer using heart's existing keys
   - Heart caveats compile to TAP policy headers (exact format TBD when Visa publishes spec)
   - Zero changes to heart core; TAP is a transport adapter like the existing MCP transport adapter
4. **When demo-able, pitch the trust layer.** Target partners: Visa (long-shot), Coinbase (realistic given x402 collaboration), Nevermined (already working with Visa on AI agent commerce per 2026 reporting).
5. **Write `backlog/tap-compatibility-layer-plan.md`** when Visa publishes concrete TAP header specs. Not before.

### Docs to write now

- **This doc** — captures the research and intuition so it's not lost. ← done.
- ~~`backlog/x402-upto-integration-plan.md`~~ — defer until spec stabilizes.
- ~~`backlog/tap-compatibility-layer-plan.md`~~ — defer until Visa publishes headers.

### Docs to update

- `backlog/heart-billing-spine.md` §"Cross-protocol abstraction" already mentions Visa TAP as a supported rail. Add a footnote pointing at this doc when we eventually build the TAP transport adapter.
- `active/gameplan-post-1-1.md` — nothing yet; these are post-1.2 concerns.
- `backlog/soma-horizon.md` — worth a one-line addition: "Soma 1.3 target: TAP compatibility layer + x402 upto support." (Not done in this doc — leaving for user approval first.)

---

## Open questions / things to dig into later

1. **What is the exact `upto` header format?** Need to read Coinbase's actual spec PR once it lands. CoinCentral/crypto.news coverage is narrative, not technical.
2. **Does TAP have a published spec?** Visa's press release didn't link one. Cloudflare's TAP content may have more. Need to dig if we go down this path.
3. **How does Visa Intelligent Commerce handle agent identity verification?** Visa → merchant → third party? This determines where Soma would slot in.
4. **What's Nevermined's positioning?** They're already working with Visa + Coinbase on agent commerce. Are they filling the scope-delegation gap, or just routing? If they're filling it, we compete with them; if they're routing, we partner.
5. **Steve Moraco / ClawAPIs angle.** Already tracked in `heydata-clawapis-soma-pitch.md`. If ClawAPIs ships Visa CLI integration before Soma has a TAP layer, they become either a partner or a direct competitor depending on how they wire scope.
6. **Chargeback handling in agent commerce.** Entirely new surface. Worth a dedicated brainstorm doc when TAP timing gets closer.
7. **"Upto" + "Soma Check" composition.** Can a single transaction be both conditional (pay zero if unchanged) AND variable (pay upto ceiling if changed)? Probably yes — Soma Check short-circuits the upto settlement when the hash matches. Worth working through the header interaction.

---

## Why this matters

The period April–June 2026 is when the agentic-commerce payment war is being fought in public. Visa TAP, Coinbase x402 + upto, Google AP2, PayPal's equivalent, Stripe machine payments — every payment incumbent is shipping an agent protocol in this window. `BlockEden.xyz` framed it as "the Agent Payment Protocol War."

**Soma's position is not to compete in that war.** Soma's position is to be the trust primitive that every combatant's stack is missing. TAP authenticates, x402 settles, AP2 orchestrates — none of them specify scope, ceremony, rotation, revocation, or human delegation. Those are the Soma primitives that just shipped in 1.1.

The strategic win is: **when the dust settles in 2026 Q3, whoever is still standing needs Soma as the layer underneath them.** This doc is the roadmap for how two specific 2026-April developments (upto shipping, TAP framing) slot into that bigger thesis.

Not this week. Not next week. But on the 6–12 week horizon, this is where the billing spine earns its real volume.
