# x402 ETag — full strategy, roadmap, value capture

**Status:** internal strategy doc. Do NOT publish this file publicly — contains pricing analysis, competitive positioning, and named-partner context.

**Last updated:** 2026-04-04.

---

## TL;DR

We invented a new sub-protocol for x402 that adds HTTP 304-style conditional payment ("pay only when data changed"). Internal name: `soma-check`. External name: **x402 ETag** (pitch: "ETag for paid APIs"). Shipped in ClawNet — tests, docs, examples, dual-branded headers, backward-compat aliases. Ready to pilot with clawapis. Need to lock in positioning as category leader before anyone else ships this pattern.

---

## Who benefits from what

### clawapis.com (the pilot partner, paid X/Twitter API, personal relationship)

| Gain | How |
|---|---|
| Revenue preservation | Still charged for fresh data — only skips double-charging unchanged data |
| Customer stickiness | Their users cut 30-70% of spend on repeat polls, less reason to churn to alternatives |
| Bandwidth savings | Don't waste compute on repeat upstream calls to the X API |
| Differentiation | "First paid X API with x402 ETag" is a real marketing claim for 6-12 months |
| Co-marketing | We publish the case study, they get named as the reference customer |
| Migration is cheap | 50-line middleware wrap; their existing endpoints keep working |

### ClawNet (us)

| Gain | How |
|---|---|
| Category definition | First protocol in the x402-sub-protocol family (ETag, future: Range/Subscribe/Batch) |
| Reference implementation | `@clawnet/x402-etag` becomes THE middleware devs reach for |
| Data flywheel | We see hit rates across the 14k+ endpoint registry — can tell any new provider "you'd save X%" |
| Network effects | Every new enabled endpoint makes the ecosystem more valuable to agents |
| Trust anchor | Our Soma cert chain backs the hash — "the server can't lie about unchanged" |
| Revenue (direct) | Per-call fee on probe endpoint, or % of provider bandwidth savings, or per-endpoint registry listing |
| Revenue (indirect) | Every x402 ETag integration routes traffic through ClawNet's orbit |
| Spec ownership | Can publish this as `x402-etag.org` or propose as an IETF draft |

### AI agents (the end users)

| Gain | How |
|---|---|
| 30-90% spend reduction | Depends on workload repetition rate |
| Lower latency on cache hits | No upstream call needed — just hash comparison |
| Predictable cost curves | Price scales with data-change rate, not poll frequency |
| Cryptographic audit trail | Every skip-charge gets a Soma-backed receipt |

---

## Value we're currently NOT capturing (gaps)

Priority tiers for closing each gap.

### Tier 1 — must-have before clawapis DM

1. **USDC telemetry** — track `calls_matched`, `usdc_saved`, `bandwidth_saved_bytes` on every skip-charge. Expose via `/v1/stats/x402-etag`. Pitch: "your users saved $X last week."
2. **Discovery flag** — `supports_x402_etag: boolean` on every endpoint in `/v1/endpoints` response, filterable via query param.
3. **npm package `@clawnet/x402-etag`** — bundle client + middleware as installable, so clawapis does `npm i @clawnet/x402-etag` not copy-paste.
4. **Landing page** at `site/x402-etag.html` — single link to send clawapis.
5. **Name lock-in** — update docs/examples to "x402 ETag" everywhere; keep `soma-check` as internal ID only.

### Tier 2 — strategic moat (capture the category)

6. **Public registry** at `clawnet.com/x402-etag-registry` — every enabled endpoint, hit rate, savings. Creates network effects + signals "category leader."
7. **Certification program** — `clawnet.com/certify` runs protocol conformance tests against any provider's endpoint, issues "x402 ETag Certified" badge. Viral growth via badge embedding.
8. **Edge proxy offering** at `etag.clawnet.com` — providers who can't/won't add middleware point DNS at us, we do hashing. Cloudflare Workers pattern, charges % of calls flowing through.
9. **Reference middleware for every framework** — Express, Fastify, Hono, FastAPI, Flask, Axum, Echo. Distribution moat.
10. **Spec publication** — own the spec at `x402-etag.org` in a clean repo with conformance suite. Anyone implementing the protocol points to our spec.

### Tier 3 — protocol family expansion

11. **x402 Batch** — `POST /v1/endpoints/check-many` takes N (endpointId, params, lastHash) tuples, returns N answers. Cuts 50 probes to 1. Critical for agents polling many endpoints.
12. **x402 Subscribe** — SSE/WebSocket endpoint pushes hash changes. Eliminates polling entirely for real-time workloads.
13. **x402 Range** — conditional payment on list diffs: "give me only the new tweets since ID X." Partial payment for partial data.
14. **x402 Vary** — multi-variant pricing (i18n, region) with per-variant hashing.

### Tier 4 — trust & safety upgrades

15. **Soma cert chain integration** — every skip-charge response chains to a Soma cache certificate. Server can't lie about "unchanged" without invalidating the cert chain.
16. **TEE-attested ETag** — provider runs in a TEE, signs hashes with attested enclave key. Premium tier. Combines with Soma's remote attestation hooks.
17. **Dispute/insurance layer** — provider stakes USDC; if they lie about "unchanged," automatic refund from stake. Requires dispute protocol or TEE.
18. **On-chain hash commitments** — periodically anchor hash roots to Base via Soma Receipt Layer, so providers can't backdate lies.

### Tier 5 — data & analytics

19. **Analytics API** — serve endpoint hit-rate heatmaps, freshness distributions, change-frequency data. Bloomberg-terminal for x402 ETag.
20. **Agent behavior signals** — score agents by polite polling, hit rates, patterns. Feeds Soma sensorium + enables discount tiers.
21. **Cross-provider dedup** — 5 providers offering BTC price with same hash? Serve once, credit all 5. Peering for paid APIs.

### Tier 6 — nice-to-haves / long-term

22. **Developer tools** — live dashboard, Chrome extension, Postman-like tester.
23. **Network token integration** — stake $CLAWNET for lower fees, priority, revenue share (per `project_token_economics` memory).
24. **Observability** — alert on hash stuck (maybe broken endpoint), hit-rate drops (data unexpectedly churning), SLA breaches.

---

## Revenue model options

Not mutually exclusive — can stack these.

| Model | Mechanism | Who pays |
|---|---|---|
| **Probe fee** | $0.0001 per `/check` probe call | Agent |
| **Skip fee** | $0.0001 per skip-charge response (provider saves $0.01 bandwidth, we take cut) | Provider |
| **Registry listing** | $X/month for premium placement in x402-etag-registry | Provider |
| **Certification** | $Y one-time for "x402 ETag Certified" badge | Provider |
| **Edge proxy** | 5-10% of calls flowing through `etag.clawnet.com` | Provider |
| **Analytics API** | $Z/month for hit-rate + freshness data | Agent / provider |
| **TEE attestation** | Premium tier — $/month for attested endpoints | Provider |
| **Insurance pool** | Take 2% of disputed call values from staking pool | Both sides |

For the clawapis pilot: **do NOT charge them.** They're the reference customer — free forever in exchange for case study rights + named co-marketing. First 3-5 adopters probably get the same deal.

---

## Competitive moat — why this is defensible

1. **First-mover naming** — "x402 ETag" ≡ us (if we publish first + own the domain). Second-movers become "compatible with x402 ETag."
2. **Soma cert chain** — nobody else has cryptographic provenance on the hash. Competitors can copy the protocol but not the trust layer.
3. **Distribution moat** — 14k+ endpoints already in ClawNet registry get hashes automatically via certified cache layer. Competitors start from zero.
4. **Spec ownership** — if we publish `x402-etag.org` with the conformance suite, we govern the protocol.
5. **Network effects** — every new enabled endpoint + every new agent = more valuable ecosystem. Cold-starting a competing standard is hard.

**Defensive action:** claim `x402-etag.org` domain this week. Publish spec there. File an informational IETF draft within 30 days (low commitment, huge positioning).

---

## Clawapis outreach plan

**Draft DM** (already composed in prior session — reproduced here for persistence):

> Hey — quick pitch. We shipped something called x402 ETag on ClawNet that lets your API consumers skip paying when data hasn't changed. Client sends `If-Fresh-Hash: <last-hash>`, server returns `{unchanged:true}` with a $0 receipt if content is identical. Same hash → no charge → no bandwidth.
>
> For a read-heavy API like yours (profile lookups, follower counts, tweet threads), this could cut 30-70% of repeat-call costs for power users without losing unique-query revenue. Drop-in header — your existing endpoints keep working.
>
> Want clawapis to be the first external x402 ETag integration? Reference customer, case study, I'll do the integration work myself. You'd get the "first paid X API to ship conditional payment" marketing claim.

**What we offer:**
- Free forever (no fees, ever)
- We write the middleware integration
- Co-published case study with savings numbers
- Featured in x402-etag-registry as launch partner
- Joint blog post / tweet thread

**What we ask:**
- 2-week pilot on one endpoint (suggest: user profile lookup — high repeat rate)
- Permission to publish hit rate + savings data (anonymized request volumes OK)
- Named as reference in future outreach

**Timing:** send AFTER tier-1 is done (USDC telemetry + discovery flag + npm package + landing page). Don't pitch an empty repo.

---

## Build order

**Week 1 (now):**
- Tier 1: telemetry, discovery flag, npm package, landing page
- Claim `x402-etag.org` domain
- Send clawapis DM once tier 1 is shipped

**Week 2:**
- Tier 2 items 6, 7 (registry + certification) — during clawapis pilot
- Draft IETF informational I-D

**Week 3-4:**
- Clawapis pilot runs, gather data
- Publish case study
- Reach out to 3-5 next providers

**Month 2:**
- Tier 3 (Batch + Subscribe) — based on clawapis pilot feedback
- Tier 2 item 8 (edge proxy) — if demand surfaces

**Month 3+:**
- Tier 4 (Soma cert integration, TEE) — turns trust story into moat
- Tier 5 (analytics API) — once we have enough data to sell

---

## Decisions locked in

- **Internal protocol ID:** `soma-check` (no refactor, no spec rewrite needed)
- **External name:** "x402 ETag" (not "x402 Fresh" — too vague)
- **Pitch one-liner:** "ETag for paid APIs" / "HTTP 304 for x402"
- **Headers:** accept `If-Fresh-Hash` + `If-Soma-Hash`, emit both `X-Fresh-Hash` + `X-Soma-Hash`. Backward-compatible forever.
- **Pricing posture:** free for first 3-5 adopters, then tiered. Never charge for `/check` probes.
- **Repo placement:** internal strategy → `clawnet/internal/`. Public Soma docs only in Soma repo.

---

## Open questions (need decisions soon)

- [ ] Should we rename headers to `X-Fresh-Hash` only (drop `X-Soma-Hash` in v1.0)? Currently emit both.
- [ ] Should `/check` probe be authenticated or remain free-public? Currently free.
- [ ] Do we front-run with an x402-etag.org publication before clawapis, or let clawapis go first?
- [ ] Registry listing fees: flat $/month vs % of calls?
- [ ] Do we open-source the middleware or keep it ClawNet-only?

---

## Related memory files

- `project_soma_check.md` — original protocol memory (renamed from x403)
- `project_soma_check_branding.md` — naming decision (external → "x402 ETag" now, was "x402 Fresh")
- `project_soma_scale_plan.md` — Soma scaling sequence, blocks Receipt Layer etc.
- `project_x402_ecosystem.md` — x402 dev event, contacts, positioning
- `project_competitive_landscape.md` — Artemis market map
