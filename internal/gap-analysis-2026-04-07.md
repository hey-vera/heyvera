# Gap Analysis: Bolts and Screws Audit

**Status:** honest assessment before build phase. NOT aspirational — factual.
**Written:** 2026-04-07.
**Method:** Full codebase audit (every src/ file, every migration, every test), cross-referenced against all internal strategy docs. Online research where noted.

---

## 0. Executive Summary

The Verified Data Machine vision describes a 4-module system where every API response is signed, cached with provenance, freshness-probed, and receipted on-chain.

**Reality check:**

| Module | Vision | Actual State | Grade |
|--------|--------|-------------|-------|
| **Heart** (signing) | Every response gets a birth cert | Only LLM calls wrapped. API endpoint calls get NOTHING signed. | **D** |
| **Cache** (storage) | Signed, verified, offline-verifiable | Cache works great. But it stores raw bytes, not signed artifacts. "Verified cache" is 0% built. | **C** |
| **Check** (freshness) | Conditional payment on every endpoint | **WORKING.** Real billing, wired into proxy, tier-aware. | **A** |
| **Receipt** (attestation) | On-chain EAS on every transaction | Receipts created in SQLite. EAS flag disabled. Zero on-chain. | **C+** |

**The Machine is running on 1 of 4 cylinders.** The outer walls (docs, vision, strategy) are polished. The inner bolts are 25% tightened.

### What's solid (the good metal):
- Credit system: atomic deductions, round6() everywhere, race-condition safe
- API key auth: timing-safe, delegation-scoped, rate-limited
- Database: 165 migrations, well-indexed, audit-logged
- Soma Check billing: fully functional, tested, wired
- Delegation chains: working, tested, enforced at auth time
- Cache layer: smart eviction (LFU), adaptive TTL, keep-warm
- Payment rails: Stripe + Solana + x402 facilitator mode

### What's weak (the bad bolts):
- Dual-sign: 90% coded, 0% wired into request pipeline
- Heart integration: only wraps LLM, not API calls
- EAS receipts: coded but feature-flagged off
- "Verified cache": concept only, zero code
- Provenance chain: 100% design docs, zero code
- Integration tests: zero
- Real traffic evidence: zero Soma Check production data

---

## 1. Security Vulnerabilities (Fix Before Anything Else)

### CRITICAL

**1.1 SQL injection in bounties tag search**
- **File:** `src/db/bounties.ts:76-77`
- **Issue:** `values.push(\`%"${params.tag}"%\`)` — no LIKE escape
- **Impact:** Data exfiltration via tag search. Attacker sends `tag=%` to match everything.
- **Fix:** Use `escapeLike()` (already exists in `src/db/marketplace.ts`)
- **Effort:** 5 minutes

### HIGH

**1.2 Delegated spend tracking is fire-and-forget**
- **File:** `src/utils/billing.ts:14-25`
- **Issue:** `trackDelegatedSpend()` is synchronous but `incrementDelegatedSpend()` can fail silently. If DB write fails, delegated key's spent counter lags. Under concurrent requests, brief overspend possible.
- **Mitigating factor:** The atomic `WHERE (spent + ?) <= limit` in `incrementDelegatedSpend` prevents actual DB-level overspend. The risk is audit trail inconsistency, not real money loss.
- **Fix:** Move spend increment into the same transaction as `deductCredit()`. Or make failure a hard error (return 500, not silent warn).
- **Effort:** 30 minutes

**1.3 Bounty escrow not atomic**
- **File:** `src/routes/bounties.ts:69-72`
- **Issue:** `deductCredit()` runs, then `createBounty()` runs separately. If bounty creation throws, credits are lost forever.
- **Fix:** Wrap both in `getDb().transaction(() => { ... })()`
- **Effort:** 15 minutes

### MEDIUM

**1.4 Cache response not validated against output schema**
- **File:** `src/cache/index.ts` + `src/routes/endpoints.ts`
- **Issue:** A compromised or malicious provider could poison cached data. `output_contract_json` exists on skills but isn't enforced on cache hits.
- **Fix:** Optional validation step on cache set (not hit — too slow).
- **Effort:** 2 hours

**1.5 Soma Check free probe reveals cache topology**
- **Issue:** `GET /v1/endpoints/:id/check` is unauthenticated by design. Anyone can enumerate all cached endpoints and their content hashes.
- **Fix:** Not a bug — this is the Soma Check design. But document it as an accepted trade-off and add rate limiting (currently 60/min per IP, which is reasonable).
- **Effort:** Documentation only

---

## 2. Core Module Gaps (The Machine's Missing Gears)

### 2.1 Heart Integration — Grade D

**What works:**
- Platform heart initializes from `PLATFORM_SIGNING_SECRET`
- `heartLlmComplete()` wraps LLM intent/synthesis calls with heartbeats + token HMACs
- `GenerationProvenance` headers exist for LLM responses

**What's broken/missing:**
- **API endpoint calls (the main product) don't produce birth certs.** When an agent calls `POST /v1/endpoints/:id/call`, the upstream response comes back unsigned. The heart never touches it.
- **`getLastBirthCertificate()` in `src/providers/clawapis.ts` is never populated.** The function exists, always returns null.
- **`_lastBirthCert` pattern was acknowledged as Phase 1 shortcut** in the Soma audit (memory: `feedback_soma_birthcert_pattern`). Never refactored.
- **No birth cert on cache hits.** Cached responses are served without any cryptographic binding.

**Why this matters:** The entire "every response is signed" claim in the Machine vision is false for ~95% of traffic. Only LLM orchestration calls get any heart involvement.

**What to build:**
1. `signEndpointResponse(data, endpointId)` — platform heart signs every upstream response
2. Attach `X-Soma-Data-Hash`, `X-Soma-Signature`, `X-Soma-Public-Key` headers on endpoint call responses
3. Store birth cert in `soma_receipts` alongside the receipt
4. For cache hits: re-sign with cache cert binding original → cached

**Effort:** 1-2 days for basic signing. 1 week for full cert chain.

### 2.2 "Verified Cache" — Grade F (Does Not Exist)

**What works:**
- LFU cache with smart eviction, adaptive TTL, keep-warm, demand tracking
- Content hash tracking for change detection (used by Soma Check)
- Redis fallback

**What's missing:**
- **Zero cryptographic signing of cached data.** The cache stores raw bytes + metadata. Not signed artifacts.
- **No cache cert generation.** The `CacheCertificate` schema exists in Soma code but is never instantiated by ClawNet.
- **No offline verification.** An agent receiving cached data cannot verify it was signed by a known provider — it's just data with a hash.

**Why this matters:** "Verified Cache" is the central differentiator in the Machine vision: "Cloudflare caches bytes, we cache provenance." Currently we also just cache bytes.

**What to build:**
1. On cache SET: create `CacheCertificate` binding `originalCert → cacheCert`
2. On cache GET: serve the cached data WITH its cert chain
3. Headers: `X-Soma-Cache-Cert`, `X-Soma-Original-Hash`, `X-Soma-Cache-Signature`
4. Consumers can verify: cached data matches original, cache operator signed it

**Dependency:** Requires 2.1 (Heart integration) to work. Can't create cache certs without birth certs to bind to.

**Effort:** 2-3 days after Heart integration is complete.

### 2.3 Receipt Layer (EAS) — Grade C+

**What works:**
- `createSomaReceipt()` fires for paid interactions
- Receipt stored in `soma_receipts` SQLite table
- `@ethereum-attestation-service/eas-sdk` integrated
- Off-chain attestation encoding works
- Merkle anchoring cron exists
- Dual-sign provenance fields exist on receipts

**What's gated:**
- `EAS_ANCHOR_ENABLED=false` — receipts created but never anchored on Base
- `PQ_SIGNATURES_ENABLED=false` — hybrid ML-DSA-65 signing disabled
- `MERKLE_ANCHOR_ENABLED=false` — batch Merkle anchoring disabled

**What's needed to activate:**
1. Register EAS schema on Base (~$0.10 gas)
2. Fund Base wallet (~$5 for gas headroom)
3. Set `EAS_SCHEMA_UID` in VPS `.env`
4. Flip `EAS_ANCHOR_ENABLED=true`
5. Monitor 24h on staging

**Why this matters:** "Permanent on-chain proof" is one env var flip away but has never been flipped. We claim on-chain receipts but deliver SQLite rows.

**Effort:** 2-4 hours for the flip. 1 day including monitoring.

### 2.4 Dual-Sign — Grade F (Dead Code)

**What exists:**
- `src/core/dual-sign.ts` — `extractProviderCert()`, `verifyProviderCert()`, `createDualSign()`
- `src/core/dual-sign-state.ts` — thread-local state management
- `src/middleware/soma-provenance.ts` — middleware scaffolding
- Tests pass for the isolated functions

**What's missing:**
- **No middleware calls `createDualSign()` on endpoint responses.** The request pipeline never invokes it.
- **`setLastDualSignResult()` is defined but never called.** There's literally no call site.
- **No response headers** (`X-Platform-Signature`, `X-Provider-Signature`) are attached.
- **Receipt dual-sign fields** (`dualSign.providerId`, `providerSignature`, etc.) are always null in production.

**Why this matters:** Dual-sign is Level 1.5 in the proof hierarchy. Two parties agreeing on data is stronger than one party signing. This is the first step toward real provenance and it's been dead since it was written.

**What to build:**
1. Middleware in the endpoint call path: after upstream fetch, call `extractProviderCert()` from response headers
2. If provider has a Soma heart (sends X-Soma-* headers): verify provider cert, create dual-sign
3. Attach dual-sign result to response headers and to the receipt
4. For providers WITHOUT Soma hearts: skip gracefully (single platform sign only)

**Dependency:** Provider must send `X-Soma-Data-Hash` + `X-Soma-Signature` headers. Currently only ClawNet's own LLM calls produce these. External providers would need Soma Heart SDK.

**Effort:** 1-2 days to wire middleware. The code is 90% done.

---

## 3. Testing Gaps (The Missing Quality Control)

### 3.1 Zero end-to-end integration tests

**What exists:** 14 unit test suites (good coverage of isolated functions). 6 smoke tests in `tests/run.ts` (health, registry, call, orchestration, cache, error).

**What's missing:**
- No test for: "agent calls endpoint → credits deducted → provider credited → receipt created → delegation tracked → Soma Check hash stored"
- No test for concurrent deductions (race condition coverage)
- No test for the dual-sign flow (because it doesn't work)
- No test for cache cert generation (because it doesn't exist)
- No test for EAS anchoring (because it's disabled)
- No dashboard test coverage at all

**Why this matters:** Unit tests prove individual bolts hold. Integration tests prove the machine works when you turn it on. We have no proof the machine works end-to-end.

**What to build:**
1. `tests/integration/full-call-flow.test.ts` — endpoint call → billing → receipt → delegation
2. `tests/integration/concurrent-deduction.test.ts` — 100 concurrent calls, verify no overspend
3. `tests/integration/soma-check-flow.test.ts` — cache hit → 304 → billing split
4. `tests/integration/delegation-chain.test.ts` — parent delegates → child calls → spend tracked → revoke cascades

**Effort:** 2-3 days for core integration tests.

### 3.2 No load testing / scale benchmarks

The scale-test-plan.md describes 5 tests (B, A, C, D, E). None have been built or run. The only performance data is theoretical estimates in docs.

**Effort:** 1-2 weeks as per scale-test-plan.md Phase A+B.

---

## 4. Operational Gaps (The Machine Isn't Running)

### 4.1 No production Soma Check data

The roadmap says "telemetry run: N≥10K calls." This hasn't happened. The Soma Check billing logic is tested in unit tests but has never processed real traffic at scale. The "you would have saved $X" pitch packet has no real numbers.

**What to do:** Run synthetic load against demo endpoints (achievable in 2 hours per roadmap). Then enable on clawapis endpoints for real data.

### 4.2 EAS schema not registered on Base

Can't flip `EAS_ANCHOR_ENABLED=true` without first registering the schema and funding the wallet. This is a 10-minute operational task that's been pending.

### 4.3 VPS env vars pending

From memory (VPS Pending section):
- `sudo ufw allow 4001/tcp` — libp2p swarm port
- `PLATFORM_PAYOUT_PRIVATE_KEY` not set
- `ADMIN_EMAIL` not set
- `HOT_WALLET_LOW_SOL` not set
- `TREASURY_SWEEP_WALLET` to remove
- `@clawnet/mcp` not published to npm

### 4.4 x402scan discovery stubbed

`src/core/x402scan-discovery.ts` returns empty array. The x402 client-side payment signing needed to poll x402scan isn't built. Without this, endpoint discovery from the x402 ecosystem doesn't work.

---

## 5. Design Gaps (Vision vs. Reality)

### 5.1 Provenance chain = 100% docs, 0% code

The provenance-chain-architecture.md describes:
- `DerivationCert` schema
- `receipt_derivations` + `derivation_inputs` tables
- Recursive CTE queries
- `X-Soma-Derived-From` headers
- 5 detection mechanisms
- C2PA/OpenLineage interop

**Zero lines of this exist in the codebase.** No migration, no table, no header parsing, no cert creation. This is pure architecture design.

**Dependency chain:** Requires 2.1 (Heart integration) → 2.4 (Dual-sign) → then provenance can be built. Can't track derivation without birth certs to link.

### 5.2 Agent reputation is basic

`src/core/vouch-ranking.ts` uses: `(0.40*trust + 0.20*volume + 0.20*tenure + 0.10*freshness + 0.10*hits) * somaBonus`. This is a single-formula ranker. The vision describes:
- Schema stability scoring
- Latency consistency (p99/p50 ratio)
- Semantic consistency
- Composite "API Reliability Index" (0-100)
- Cross-provider comparison
- Historical anomaly detection

**What exists:** Basic trust score + volume. What's described: rich multi-signal reputation engine.

### 5.3 Token = design only

`internal/token-architecture.md` is comprehensive. Zero smart contract code, zero staking logic, zero governance. This is expected (launch at $50-100K monthly revenue milestone) but worth acknowledging — the token flywheel described in the Machine vision doesn't exist yet.

### 5.4 Dispute resolution = schema only

Escrow table exists in the database. A basic dispute flow exists. But the structured process described in the Machine vision (UMA-style, economic stakes, automated tier, community arbitration) is not built.

### 5.5 Fleet identity (hierarchical hearts) = concept only

The entire Section 8 of verified-data-machine.md (HD derivation, BLS aggregate, SPIFFE-style) is pure brainstorming. No code, no dependencies added, no schema.

---

## 6. Dependency Chain (What Must Be Built In Order)

This is the critical path. Items cannot be parallelized if they have dependencies:

```
LAYER 0: Security fixes (no dependencies, do first)
  ├── 1.1 Bounties SQL injection fix
  ├── 1.2 Delegated spend atomicity
  └── 1.3 Bounty escrow transaction wrap

LAYER 1: Core signing (everything depends on this)
  └── 2.1 Heart integration on endpoint calls
       ├── Birth certs on every API response
       └── X-Soma-* response headers

LAYER 2: Built on Heart (parallel after Layer 1)
  ├── 2.4 Dual-sign middleware (needs Heart producing certs)
  ├── 2.2 Verified Cache (needs birth certs to bind to)
  └── 2.3 EAS activation (needs Heart certs in receipts)

LAYER 3: Built on Layer 2 (parallel after Layer 2)
  ├── 5.1 Provenance chain / DerivationCert (needs dual-sign + birth certs)
  ├── 3.1 Integration tests (needs working Heart + dual-sign + receipts)
  └── 3.2 Scale testing (needs working core modules)

LAYER 4: Built on production evidence
  ├── 4.1 Telemetry run (needs working billing + receipts)
  ├── 5.2 Enhanced reputation (needs traffic data)
  └── 5.4 Dispute resolution (needs receipts + trust scores)

LAYER 5: Built on everything
  ├── 5.3 Token launch (needs production evidence + revenue)
  ├── 5.5 Fleet identity (needs working provenance chain)
  └── Agent Network Operator Platform (needs fleet + provenance + reputation + token)
```

---

## 7. Honest Build Plan — Ground Up

### Phase 0: Fix the Bolts (Day 1)
- [ ] SQL injection fix in bounties tag search
- [ ] Bounty escrow wrap in transaction
- [ ] Delegated spend tracking: log.error on failure, don't swallow
- **Time:** 2-4 hours
- **Risk if skipped:** Data exfiltration, lost credits

### Phase 1: Heart on Every Response (Week 1)
- [ ] `signEndpointResponse()` — platform heart signs upstream data
- [ ] Attach X-Soma-Data-Hash, X-Soma-Signature, X-Soma-Public-Key on endpoint responses
- [ ] Store birth cert reference on soma_receipts
- [ ] Tests: unit + integration for signing flow
- **Time:** 3-5 days
- **Risk if skipped:** The Machine vision is fiction. "Every response is signed" is a lie.
- **Dependency:** None — heart already initializes

### Phase 2: Wire Dual-Sign + Activate EAS (Week 2)
- [ ] Dual-sign middleware: extract provider certs, co-sign, attach headers
- [ ] EAS schema registration on Base
- [ ] Flip EAS_ANCHOR_ENABLED=true on staging
- [ ] Verified Cache: create CacheCertificates on cache SET, serve with cache GET
- [ ] Tests: dual-sign flow, EAS anchoring, cache cert generation
- **Time:** 5-7 days
- **Dependency:** Phase 1 (heart producing certs)

### Phase 3: Integration Tests + Scale (Week 3-4)
- [ ] Full call flow integration test
- [ ] Concurrent deduction test
- [ ] Soma Check billing flow test
- [ ] Scale test B (1×100 delegated) — the realistic hot path
- [ ] Scale test A (100 flat hearts)
- **Time:** 1-2 weeks
- **Dependency:** Phase 2 (all core modules working)

### Phase 4: Real Traffic + Telemetry (Week 5-6)
- [ ] Synthetic load: 10K calls through demo endpoints
- [ ] Enable Soma Check on clawapis endpoints (Tier 0 → Tier 1)
- [ ] EAS anchoring promoted to production
- [ ] "You saved $X" pitch packet with real numbers
- [ ] VPS env vars cleaned up
- **Time:** 1-2 weeks
- **Dependency:** Phase 3 (proven under test load)

### Phase 5: Provenance Chain (Month 2-3)
- [ ] DerivationCert schema + migration
- [ ] X-Soma-Derived-From header parsing + emission
- [ ] Provenance DAG queries (recursive CTE)
- [ ] Dashboard: provenance chain viewer
- [ ] Enhanced reputation scoring (multi-signal)
- **Time:** 3-4 weeks
- **Dependency:** Phase 4 (production evidence of core modules working)

### Phase 6: Advanced (Month 3+)
- [ ] Fleet identity (hierarchical hearts, HD derivation)
- [ ] Token smart contract + staking
- [ ] Dispute resolution v1
- [ ] Agent Network Operator dashboard
- **Time:** Months
- **Dependency:** Phase 5 + revenue milestones

---

## 8. What NOT to Build Yet

Do not start these until Phases 0-4 are complete:

- **Provenance chain** — design is solid but building it on an unsigned cache and disabled receipts is pointless
- **Fleet identity** — can't manage 1000 agent hearts if 1 heart doesn't work properly
- **Token** — launching a token with no production evidence is how projects die
- **BLS aggregate signatures** — optimization for a problem we haven't proven we have
- **SNARK compression** — same
- **C2PA/OpenLineage interop** — nice-to-have, not foundational
- **Agent Network Operator Platform** — the capstone, not the foundation

---

## 9. The Honest Assessment

The vision is excellent. The strategy docs are some of the best I've seen. The competitive analysis is thorough. The architecture design (provenance chain, hierarchical hearts, modular machine) is sound.

**But the code tells a different story.** The foundation (signing, caching provenance, on-chain receipts, dual verification) is half-built. Building the upper floors (provenance chains, fleet identity, agent networks, token economics) on this foundation would be building a skyscraper on a cracked slab.

**The good news:** The cracks are fixable. Most of the code exists — it just needs to be wired together. The security fixes are trivial (hours). Heart integration is days. Dual-sign is days. EAS is hours. These aren't months of work.

**The fix:** Build from the ground up. Security → Heart → Dual-sign → EAS → Tests → Scale → Traffic → Then advanced features. No shortcuts, no skipping layers.

**The Machine will work.** But right now it's a 4-cylinder engine running on 1 cylinder, with 3 cylinders machined and sitting on the workbench. The job is to install them, not design more cylinders.

---

## Related Docs

- `verified-data-machine.md` — the vision (what we're building toward)
- `provenance-chain-architecture.md` — Session A deep design (Phase 5 target)
- `golden-plan.md` — strategic positioning (unchanged by this audit)
- `roadmap.md` — existing build plan (this doc supplements it)
- `scale-test-plan.md` — test matrix (Phase 3 of this plan)
- `brainstorm.md` — idea capture (paused until foundation is solid)
