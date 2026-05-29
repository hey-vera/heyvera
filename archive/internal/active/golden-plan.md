# The Golden Plan — Strategic Vision

**Status:** canonical strategy doc. Supersedes ad-hoc decisions. If this conflicts with other internal docs, this one wins on strategic direction; specific subsystem docs win on implementation detail.
**Written:** 2026-04-05.
**Research basis:** competitive intelligence (x402 Foundation, MCP, A2A, Stripe MPP, ACP, UCP), pricing psychology (Gurley, a16z, Metronome field research), API marketplace graveyard analysis, infrastructure platform case studies (Stripe, Cloudflare, Let's Encrypt).

---

## 0. Identity

**ClawNet is NOT an API marketplace. ClawNet is Soma-verified agent infrastructure.**

Every horizontal API marketplace has failed: RapidAPI ($1B valuation -> sold to Nokia after 82% layoff), Mashape (absorbed), ProgrammableWeb (shut down after 17 years). Pattern: marketplaces that just route traffic die. Infrastructure that absorbs complexity wins (Stripe: $19.4B revenue, Cloudflare: $1.67B revenue).

**One-sentence positioning:** "x402 says money moved. Soma proves data was real. ClawNet makes both easy."

**Why this framing matters:** When we say "marketplace," we compete with RapidAPI's ghost. When we say "infrastructure," we compete with Stripe/Cloudflare — and we're building the same kind of moat (operational complexity absorption + data network effects).

---

## 1. Three Unbundled Layers

### Layer 1 — Soma Protocol (open, free, forever)

| Component | What it does | Status |
|-----------|-------------|--------|
| **Soma Check** (x402 ETag) | Conditional payment via content-addressed hashing | Phase 1 shipped |
| **Soma Heart** | Cryptographic identity — birth certs for computation | Live |
| **Soma Sense** | Third-party verification — observer sovereignty | Experimental |
| **Soma Receipt** | EAS-anchored delivery proofs on Base | Design phase |
| **Soma Delegation** | Scoped agent-to-agent trust chains | v0.1 shipped |

**Published as an open spec. Anyone can implement.** This is the Let's Encrypt / HTTP / MCP playbook.

**Why open:** Let's Encrypt didn't kill CAs — it grew HTTPS from 40% to 95% and expanded the CA market 3x. Opening the protocol grows the pie. Every agent using Soma Check, regardless of platform, makes the trust network more valuable.

**Key finding:** Nobody else combines content-addressed hashing with conditional payment. The entire AI agent caching conversation is about semantic caching (LLM query dedup) or CDN infrastructure. Soma Check is the most differentiated primitive in the agent economy.

### Layer 2 — Soma Trust Network (free to join, network effect moat)

| Feature | Cost |
|---------|------|
| Provider identity + Soma DID | Free |
| Trust score (computed from receipts, uptime, accuracy) | Free to query |
| EAS attestations on Base | Free (basic) |
| Birth cert verification | Free |
| Vouch discovery ranking | Free |
| **Premium:** PQ crypto (ML-DSA-65), compliance reports, SLA guarantees | Paid |

**Moat:** you can fork the code, you can't fork 10,000 providers with trust histories. This is Cloudflare's playbook — every free user contributes data that makes the product better for everyone.

### Layer 3 — ClawNet / ClawAPIs (infrastructure layer, revenue)

| Product | Revenue model |
|---------|---------------|
| ClawAPIs catalog (discovery + listing) | Take rate on live calls |
| Orchestration (`/v1/orchestrate`) | Flat fee per query |
| Billing abstraction (credits, x402, Stripe) | Take rate on live calls |
| Managed caching (cross-provider dedup, adaptive TTL) | Included (competitive advantage) |
| Agent wallet management | Small fee on deposits |
| Analytics & demand signals | Free basic, premium subscription |
| MCP sub-registry (Soma-verified tools) | Included |

---

## 2. Four Provider Paths

| Option | Uses | Platform Fee | Cache Hits | Best For |
|--------|------|-------------|------------|----------|
| **Full Stack** | ClawAPIs + Soma | 5-10% live calls | Provider keeps 95-100% | Most providers, zero ops |
| **Soma Only** | Trust network, BYO billing | Free (premium trust paid) | Provider keeps 100% | Large providers with own agents |
| **Marketplace Only** | ClawAPIs, no Soma | 10% live calls | No cache revenue | Quick listing |
| **Direct** | Nothing | 0% | N/A | Status quo |

**Key:** No lock-in. Providers pick their level of participation. This unbundling reduces fear and increases adoption velocity.

---

## 3. Pricing Philosophy

**Display in USD, not credits.** See `internal/archive/pricing-economics.md (archived)` for full rationale. Summary:
- 78% of developers reject tools with unclear pricing
- Gaming-style inflated credits (millions of tokens) destroy B2B trust
- Twilio, Stripe, AWS all show real currency — we should too
- Internal credit accounting stays unchanged; display layer converts to USD

**Take rates (evidence-based):**
- 10% on live calls — confirmed by Gurley research, Booking.com case study, competitive benchmarks
- 5% on Soma Check cache hits (Tier 1-2), 3% on Champion (Tier 3)
- OR: 0% platform share on cache hits (provider keeps 100%) — see `internal/archive/pricing-economics.md (archived)` for full analysis
- $0.002 flat orchestration fee — like Stripe's per-txn fee

---

## 4. Moat Stack (ranked by defensibility)

1. **Trust data network effect** — every receipt/attestation makes the network better. Can't fork it.
2. **Scoped delegation** — 6 months ahead of IETF draft-klrc-aiagent-auth. Working code + published spec.
3. **Proof-of-Delivery** — "x402 says money moved. Soma proves data was real." No competitor has this.
4. **Soma Check (category creator)** — first conditional-payment protocol for APIs. Nobody else is doing it.
5. **Cross-provider intelligence** — 14K+ endpoints with hit rate, volatility, freshness data.
6. **Agent wallet lock-in** — load once, spend across all providers.
7. **MCP registry position** — MCP supports sub-registries. Soma-verified tool registry.

---

## 5. Growth Flywheel

```
Open Soma Protocol (free)
  -> More agents use Soma Check (save money)
  -> More providers join trust network (trust scores)
  -> Better trust data (network effect compounds)
  -> Agents prefer Soma-verified providers
  -> More providers list on ClawAPIs (convenience)
  -> More origin call revenue
  -> Better infrastructure investment
  -> Back to start, but bigger
```

---

## 6. Related Docs

- `internal/archive/pricing-economics.md (archived)` — credit denomination, take rates, cache economics, volume discounts
- `internal/archive/tier-system.md (archived)` — unified agent + provider tier system
- `internal/token-architecture.md` — $CLAWNET token design, BME model, burn mechanics, regulatory
- `internal/roadmap.md` — implementation order and timelines
- `internal/archive/soma-check-billing.md (archived)` — per-call billing math
- `internal/archive/soma-onboarding-ladder.md (archived)` — provider onboarding flow
