# Soma Readiness & Strategy — Can ClawNet Be THE Implementation?

**Written:** 2026-04-05
**Status:** canonical strategy doc — source of truth for Soma production-readiness + competitive positioning
**Scope:** ruthless gap analysis + 90-day critical path + competitive clock

This doc answers the question: **"Can ClawNet be the best Soma implementation for the future of AI agents?"** The short answer is yes, but with a narrow window and concrete work.

---

## 1. TL;DR — ClawNet is 35% production-ready

| Layer | % Live end-to-end | Reality check |
|---|---|---|
| **Pay** | 85% | Credits + x402 + Solana + Stripe all functional. Only battle-tested layer. |
| **Receipt** | 70% code / **0% live** | All crypto wired. Every anchor flag is OFF (`EAS_ANCHOR_ENABLED=false`, `PQ_SIGNATURES_ENABLED=false`, `ZKTLS_ENABLED=false`, `MERKLE_ANCHOR_ENABLED=false`). Zero on-chain attestations. |
| **Check** | 65% code / **partial live** | Works on 6 demo endpoints. **Not** on the real proxy path `/v1/endpoints/:id/call`. Demo numbers are theatre. |
| **Identity** | 40% | Heart initialized + signs. Sense verdict schema exists but `birth_certificates_valid`, `hmac_verified`, `heartbeat_chain_valid` flags stored without computation. |
| **Bazaar** | 15% | `providers` table + `/.well-known/agent-card.json`. Zero ranking, zero discovery API, zero trust graph. |

**Honest headline:** ClawNet is a solid billing platform with Soma *hooks*. It is not yet running a 5-layer Soma stack in anger.

---

## 2. The five gaps blocking "best implementation" status

### Gap A — Soma Check on the proxy path (not just demos) ✓ SHIPPED 2026-04-05

**What:** Every call through `/v1/endpoints/:id/call` that sends `If-Soma-Hash` (or `If-Fresh-Hash`) is now billed at hit-price via `computeSomaCheckSplit()` with the provider's Soma Check tier, credits the provider 90% (T1-2) or 95% (T3), and logs non-shadow `soma_check_events` rows.

**Why critical:** Without this, we had **zero real-world hit-rate numbers to pitch** to clawapis or any provider. The Soma Check billing calculator was never called on real traffic — the proxy path returned `creditsUsed: 0` on hash matches.

**What shipped:**
- Migration 148: `providers.soma_check_tier INTEGER NOT NULL DEFAULT 0` (distinct from legacy `tier` text column)
- `getProviderSomaCheckTier(endpointId)` + `setProviderSomaCheckTier(providerId, tier)` in `src/db/providers.ts`
- `creditProviderShare({ providerSharePctOverride })` option plumbed through
- `src/routes/endpoints.ts` hash-match branch now charges hit price, credits provider, un-shadows telemetry when tier ≥ 1
- `X-Soma-Tier`, `X-Soma-Hit-Price`, `ETag` response headers added
- ClawNet L1/L2 cache-hit shadow telemetry now logs actual projected tier + hit-price split instead of always logging `tier: 0`
- Tier 0 = shadow (free) preserved for zero-disruption onboarding ladder
- 202/202 unit tests pass with migration applied

**Next:** Promote clawapis endpoints Tier 0 → Tier 1 once they consent; run real-traffic N≥10K to get numbers for case study.

---

### Gap B — Soma Delegation Spec (the strategic whitespace)

**What:** Formalize the scoped-delegation primitive we already half-built. `trackDelegatedSpend()` tracks child→parent spend across ~20 billing sites. Missing: depth limits, per-hop scope narrowing, per-branch spend caps, cascade revoke, intent declaration at creation.

**Why critical:** Per Grantex *State of Agent Security 2026*, CrewAI/AutoGen/MetaGPT all lack this. A parent agent hands full API-key authority to children → one rogue child spends $50k → no cascade revoke. This is the single most-cited unsolved pain in multi-agent literature.

**Competitive threat:** IETF `draft-klrc-aiagent-auth-01` is standardizing agent auth **right now**. If they adopt delegation semantics first, our `trackDelegatedSpend` code becomes a ClawNet feature instead of the reference implementation of a standard.

**What we have:** `delegation_keys` table, depth-1 parent→child tracking, `trackDelegatedSpend()` helper, escrow holds.

**What's missing:**
- Depth limits (currently unlimited delegation chain depth)
- Scope narrowing (child must have ≤ parent's permissions; currently children inherit everything)
- Per-branch spend caps (`parent has $100 → can cap child at $5`)
- Cascade revoke (kill parent → all descendants die)
- Intent declaration at key creation ("this agent exists to do X only")

**Effort:** 2 weeks for spec doc + 2-3 weeks for code. **Highest strategic moat** — this is the layer where we're 6 months ahead of competitors.

**Todos:**
- [ ] Write `internal/soma-delegation-spec.md` (v0.1 draft) — scope, depth, revoke, intent
- [ ] Add `depth`, `max_depth`, `branch_spend_limit`, `intent_declaration` columns to `delegation_keys` table (migration 148)
- [ ] Implement cascade revoke: revoking parent key marks all `parent_key = ?` children inactive recursively
- [ ] Publish spec to `github.com/1xmint/soma-delegation-spec` before IETF draft-klrc adoption
- [ ] Submit as x402 Foundation extension + MCP delegation pattern reference

---

### Gap C — Receipts actually on-chain (flip the switches)

**What:** Activate EAS anchoring on Base so receipts become cryptographically verifiable on-chain, not just SQLite rows.

**Why critical:** Mastercard "Verifiable Intent" (Jan 2026) is building enterprise agent attestations. SOC2/HIPAA customers will demand cryptographic audit trails. **We already wrote the code** — we just haven't flipped `EAS_ANCHOR_ENABLED=true`.

**Blockers:**
- Register EAS schema UID on Base (one-time, ~$0.10 gas)
- Need Base RPC credentials (can use public `mainnet.base.org`)
- Decide batching cadence (currently 1h, acceptable for most audit use cases)

**Effort:** 1 day for activation. Primarily requires user decision + on-chain registration.

**Todos:**
- [ ] Register EAS schema on Base (fields: request_hash, response_hash, payment_method, amount_usd, timestamp, signer)
- [ ] Set `EAS_SCHEMA_UID` in VPS `.env`
- [ ] Fund Base wallet with ~$5 USDC for gas headroom
- [ ] Flip `EAS_ANCHOR_ENABLED=true` on staging first
- [ ] Monitor first 24h anchoring cron runs
- [ ] Promote to prod; announce "receipts now on-chain" as a Soma Receipt layer milestone
- [ ] Add public receipt verification endpoint: `GET /v1/soma/receipt/:id/onchain` returns EAS tx hash + attestation

---

### Gap D — Sense observer reference implementation

**What:** Standalone `soma-sense` binary/SDK that a third party runs, monitors agent behavior, signs verdicts, submits to ClawNet via `POST /v1/soma/verdicts`.

**Why critical:** Our own doctrine says *"never self-verify — observer must be separate party"* (`CLAUDE.md`). Without shipped observer software, Sense is pure theory and competitors can claim we're self-attesting.

**Current state:** Verdict submission endpoint works. Trust query works. Zero code produces verdicts. All observer verdicts are hand-crafted.

**Effort:** 1-2 weeks. Not urgent — but Identity layer is half-deaf without this.

**Todos:**
- [ ] Spec `soma-sense-observer.md`: what checks it performs (temporal, topology, vocabulary, model-fingerprint)
- [ ] Build `packages/soma-sense` npm package: monitors LLM output streams, computes baseline, emits verdicts
- [ ] Ship reference Docker image running observer against public ClawNet endpoints
- [ ] Document "run your own observer" guide on soma.dev

---

### Gap E — Bazaar ranking + discovery API

**What:** `GET /v1/soma/bazaar/search?capability=X` returning endpoints ranked by verdict data + volume + tenure + transitive trust.

**Why critical:** **A2A Protocol (Google + Linux Foundation, 50+ partners including PayPal, Salesforce, MongoDB)** is Agent Cards = Bazaar equivalent. If A2A bolts payment routing on top, our discovery layer is commoditized. ([a2aproject/A2A](https://github.com/a2aproject/A2A))

**Current state:** `providers` table exists. Zero ranking, zero search, zero transitive traversal.

**What we have that A2A doesn't:** verdict data (`soma_verdicts`), payment integration, delegation. We can differentiate on *trust-weighted* discovery, not just capability matching.

**Effort:** 1 week MVP (ranking algorithm) + 3-4 weeks transitive trust.

**Todos:**
- [ ] Design ranking formula: `score = verdict_positive_ratio × volume_factor × tenure × freshness_factor`
- [ ] Implement `GET /v1/soma/bazaar/search` with capability filter + ranked results
- [ ] Add Bazaar tab to `site/soma-check.html` dashboard for provider discoverability
- [ ] Expose agent-card.json endpoint per-provider (A2A-compatible format)
- [ ] Transitive trust v1: walk verdict graph 2 hops, weight by signer reputation
- [ ] Cross-reference agent-card.json with A2A spec for interop

---

## 3. Future agent scenarios — where we fit, where we don't

| Scenario | Primitive needed | Soma layer | ClawNet ready? |
|---|---|---|---|
| Trading bots (24/7 polling) | Conditional payment | Check | ✓ after Gap A |
| AI coding assistants | Data provenance + spend caps | Identity + Pay | ~ partial |
| Research/analyst agents | Citation attestations, transitive trust | Bazaar + Receipt | ✗ |
| Real-time chat agents | Async/lazy receipt verification | Receipt (new mode) | ✗ |
| Data pipeline agents | Batch Merkle manifest | Receipt (batch mode) | ~ code exists, off |
| **Multi-agent swarms** | **Scoped delegation** | Pay + Identity (new) | ~ **our moat** |
| **Embodied/robotic agents** | **Safety-interlock** | **6th layer (new)** | ✗ whitespace |
| Memory/learning markets | Outcome-based escrow | Pay (new variant) | ✗ |
| Enterprise SOC2/HIPAA | Immutable on-chain audit | Receipt | ✗ after Gap C |
| Consumer privacy agents | Blind/ZK payments | Pay (new variant) | ✗ |
| Agentic commerce | Escrow + dispute | Receipt + Pay | ~ escrow partial |
| Red-team / bug-bounty | Attested intent at handshake | Bazaar + Identity | ✗ |

**Verdict:** after closing Gap A, we cover Scenario 1 at production quality. After Gaps A+B+C, we cover Scenarios 1, 6, 9 well. Everything else requires new layers or substantial new code.

---

## 4. Two candidate 6th Soma layers

### Layer 6A — Safety-Interlock (refuse-to-act semantics)

**What:** Agent declines to act when verdict confidence < threshold OR when input data provenance fails validation. Provider declines to serve when declared intent violates policy.

**Why:** Embodied agents, high-stakes automation, industrial IoT. **Nobody is building this.** Pure whitespace for 2027-2028.

**Primitive:** `X-Soma-Safety-Policy` header declaring refuse-conditions; agent SDK consumes and enforces.

**Positioning:** "Soma Safety — the refuse-to-act protocol for high-stakes agents."

### Layer 6B — Intent Declaration (pre-transaction)

**What:** Agent declares *why* it's calling + what it'll do with the data, signed and posted to Bazaar.

**Why:** Providers can price by intent (research vs. production), rate-limit adversarial use, distinguish legitimate bounty probing from APT exfiltration.

**Competitive overlap:** Mastercard Verifiable Intent + IETF `draft-sharif-agent-payment-trust-00` are building adjacent primitives. Standards fight in progress.

**Positioning:** "Intent declaration as a prerequisite for x402 payment authorization."

---

## 5. Competitive clock — the next 90 days

| Threat | What they do | Status | Our counter | Deadline |
|---|---|---|---|---|
| **A2A Protocol** (Google + LF) | Agent Cards, capability discovery | Already shipping, 50+ partners | Bazaar MVP with A2A-compatible agent-cards | Q2 2026 |
| **Mastercard Verifiable Intent** | Enterprise agent attestations | Jan 2026 launch | Flip `EAS_ANCHOR_ENABLED=true`, publish Receipt spec | Q2 2026 |
| **IETF draft-klrc-aiagent-auth** | Agent auth/delegation | Draft pending adoption | Publish Soma Delegation Spec v0.1 | **8 weeks** |
| **IETF draft-sharif-agent-payment-trust** | Payment trust attestations | Draft pending adoption | Link Soma Identity to this draft's terminology | Q3 2026 |
| **x402 Foundation** (Coinbase + Cloudflare) | Payment standardization | Tailwind | Push clawapis onto x402 stack | ongoing |
| **MCP 2026 roadmap** | Audit trails, task lifecycle | Q2-Q4 2026 | Position Soma as MCP audit layer | Q3 2026 |

**Sources:**
- [A2A](https://github.com/a2aproject/A2A), [A2A spec](https://a2a-protocol.org/latest/specification/)
- [MCP 2026 roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [Mastercard Verifiable Intent (PYMNTS)](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/)
- [IETF draft-sharif](https://datatracker.ietf.org/doc/html/draft-sharif-agent-payment-trust-00)
- [IETF draft-klrc](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/)
- [Coinbase/Cloudflare x402 Foundation](https://www.coinbase.com/blog/coinbase-and-cloudflare-will-launch-x402-foundation)
- [Grantex State of Agent Security 2026](https://grantex.dev/report/state-of-agent-security-2026)

**Critical path:** next 90 days determine whether Soma becomes a standard or stays a ClawNet feature.

---

## 6. 90-day prioritized build plan

### Week 1-2 (immediate — P0)
1. **Gap A activation** — Soma Check on proxy path (1 day, highest ROI)
2. **Delegation Spec v0.1** — markdown doc in `internal/` + public repo (1 week)
3. **Gap C activation** — flip `EAS_ANCHOR_ENABLED=true` (1 day + monitoring)

### Week 3-4 (high priority — P1)
4. **Bazaar MVP ranking API** (1 week, uses existing tables)
5. **Delegation primitive code** — depth limits + cascade revoke (1-2 weeks)
6. **Receipt async batch mode** — inline sign, hourly EAS batch (code exists, needs policy)

### Month 2-3 (strategic — P2)
7. **Sense observer binary** — reference implementation (1-2 weeks)
8. **Safety-Interlock whitepaper** — claim 6th-layer whitespace (1 week writing)
9. **Publish Delegation Spec to coinbase/x402 as extension** (1 week coordination)
10. **A2A-compatible agent-card.json per provider** — interop play (3 days)

### Deferred (validate first, build later)
- Token economics ($CLAWNET)
- ZK/blind payments
- Outcome-based escrow
- Transitive trust graph (>2 hops)
- Streaming settlement (LLM tokens)
- Semantic cache for stochastic outputs
- Cache Pioneer Bonus
- Subscription primitive

---

## 7. Bottom line

**Can ClawNet be the best Soma implementation?** Yes. But:
- **Today we are not one.** We are a billing platform with demo Soma endpoints.
- **Closest competitors (A2A, Mastercard, IETF) are moving.** 90-day window.
- **Our unique moat is composability + delegation.** Others build single-layer. Soma's 5-layer stack is *the* differentiator — but only if all 5 layers are real.
- **Fastest wins are turning on what's already built** — Gap A and Gap C require zero new design work.
- **Biggest strategic bet is Delegation Spec** — doctrinal whitespace with an 8-week IETF-race deadline.

---

## Related docs

- `internal/roadmap.md` — master what/why/todos (this doc's priorities flow into roadmap §3)
- `internal/soma-check-strategy.md` — Soma Check specifics
- `internal/cache-layers-distinction.md` — ClawNet cache vs Soma Check
- `internal/funds-flow.md` — how money reaches providers
- `internal/soma-delegation-spec.md` — (to be written, part of Gap B)
- `internal/groundbreaking-extensions.md` — extension ideas (overlaps with §3 scenarios)
