> **ARCHIVED** — Superseded on 2026-04-08
> **Outcome:** Shadow tier (Tier 0) removed in migration v163 — all providers start at Tier 1 (active billing). Provider gets 100% of all hit revenue. The tier progression concept (Passive → Verified → Champion) may still apply for future features but billing splits are now flat 100% provider.
> **See instead:** `active/revenue-architecture.md`

# Soma Check — Provider Onboarding Ladder

**Status:** canonical onboarding spec for the Soma Check layer.
**Written 2026-04-05.** Referenced from `soma-check-strategy.md`.

---

## Design principle

**Zero-disruption, opt-in, shadow-first.** No provider should ever touch their response format on day one. Adoption climbs a ladder at the provider's pace.

---

## Two paths

| Path | Middleware location | Provider effort | Covers |
|---|---|---|---|
| **A. ClawNet-proxied** | Runs inside ClawNet's proxy layer (`src/routes/endpoints.ts`) | Zero | Traffic routed through `/v1/endpoints/:id/call` |
| **B. Direct integration** | Provider installs `@clawnet/soma-check` npm on their server | ~50 lines | Provider's direct customers (non-ClawNet traffic) |

**Ship Path A first.** Proves savings without provider action. Path B pitched later, backed by Path A numbers.

---

## Four tiers

### Tier 0 — Shadow Mode (entry point, default)

**What it is:** telemetry-only. Every response ClawNet proxies through to the provider gets hashed (JCS canonicalized → SHA-256). ClawNet records what WOULD have been a cache hit if a client had sent `If-None-Match`. No response changes, no billing changes.

**Provider effort:** None. ClawNet enables it silently on their proxied endpoints.

**Customer impact:** Zero. Responses are identical byte-for-byte.

**Billing:** Unchanged. Every call is a full origin call at full origin price.

**What provider gets:** after 14 days, a dashboard showing:
- Would-have-been cache-hit rate per endpoint
- Projected bandwidth savings if Tier 1 activated
- Projected revenue impact (usually positive — see `soma-check-billing.md`)
- Content volatility per endpoint (identifies which endpoints benefit most)

**What ClawNet gets:** telemetry data + proof points for pitching Tier 1.

**Exit criteria to Tier 1:** provider sees ≥25% projected hit rate on ≥1 endpoint AND signs off on moving forward.

---

### Tier 1 — Passive Check (billing activates)

**What it is:** ClawNet emits `ETag` header on proxied responses. Clients that send `If-None-Match` get a `304 Not Modified` when hash matches. Clients that don't send it see no change.

**Provider effort:** None additional (ClawNet proxy does the work). Provider flips a flag: "OK to serve 304s on cached hits."

**Customer impact:** Opt-in only. Clients who update to send `If-None-Match` get cheaper calls. Clients who don't — identical to Tier 0.

**Billing:** Active. Cache hit = 10% of origin price, split 90/10 (provider/ClawNet) — matching origin split.

**What provider gets:**
- First real revenue from cache hits (100% profit margin — served nothing)
- Monthly savings report
- "Soma Check enabled" badge on their ClawNet registry listing

**What ClawNet gets:**
- 1% of origin per cache hit (10% split × 10% hit price)
- Real-world validation of the billing model
- Bandwidth/egress savings

**Exit criteria to Tier 2:** provider wants identity verification + Vouch listing boost.

---

### Tier 2 — Verified (identity layer joins)

**What it is:** Provider generates a Soma Heart (or ClawNet hosts one for them). Responses get a Soma-signed `X-Soma-Signer` header. Hash verification becomes cryptographically bound to a provider identity.

**Provider effort:** One-time Heart generation + key custody decision (self-hosted vs ClawNet-managed).

**Customer impact:** Invisible. Extra headers only.

**Billing:** Unchanged from Tier 1 (still 90/10).

**What provider gets:**
- "Soma Verified" badge (visual distinction)
- Priority ranking in Soma Vouch discovery
- Trust propagation — agents can pass verified attestations to peers
- Access to Soma Identity layer APIs (selective disclosure, delegation)

**What ClawNet gets:**
- Identity layer adoption (feeds the 5-layer flywheel)
- Soma Vouch grows in verified-provider count
- Provider stickiness increases

**Exit criteria to Tier 3:** provider achieves volume thresholds + refers peers.

---

### Tier 3 — Champion (upgraded split + co-marketing)

**What it is:** Provider has demonstrated volume (>X calls/day) AND referred ≥3 peer providers AND published a case study with us.

**Provider effort:** Maintain volume + evangelism. Optional: joint marketing appearances, spec review participation.

**Customer impact:** Invisible.

**Billing:** Cache hit split shifts to **95/5** (provider/ClawNet). Provider earns 9.5% of origin per cache hit (vs 9% at Tier 2).

**What provider gets:**
- Top placement in Soma Vouch
- Co-branded case study on soma.dev
- Referral kickbacks (% of first-year revenue from referred providers)
- Early access to new Soma layers
- Direct input on protocol decisions

**What ClawNet gets:**
- Scarce resource: evangelists who bring other providers
- Case studies that close Tier 0 sales
- Network effects compound

**No Tier 4 defined yet.** Champion is the ceiling for v1. Strategic providers can negotiate custom arrangements case-by-case.

---

## Movement rules

- **Promotion is unidirectional.** Once a provider reaches Tier N, they don't drop unless they explicitly opt out.
- **No tier skipping.** Tier 0 → 1 → 2 → 3 in sequence. Each tier proves readiness for the next.
- **Tier 0 is always free.** Shadow mode costs nothing and extracts no commitments.
- **Champion Tier is earned, not bought.** Can't pay into it — must demonstrate volume + referrals.

---

## Onboarding flow (provider lens)

```
[ClawNet proxies your endpoint]
           ↓
  Tier 0: Shadow Mode (automatic, silent)
           ↓   (14 days + provider approval)
  Tier 1: Passive Check (one flag flip)
           ↓   (provider wants trust layer)
  Tier 2: Verified (generate Heart, get badge)
           ↓   (volume + referrals + case study)
  Tier 3: Champion (95/5 split, co-marketing)
```

---

## Onboarding flow (ClawNet lens)

1. **Auto-enroll** every ClawNet-registered endpoint in Tier 0 shadow mode (no provider action)
2. **Profile content volatility** over 24h — flag which endpoints benefit from Soma Check
3. **Surface dashboards** to providers showing their potential savings
4. **Convert to Tier 1** when provider sees the numbers
5. **Pitch Tier 2** after 30 days of Tier 1 stability
6. **Invite to Champion** based on volume + referral behavior

---

## Edge cases

**Volatile endpoints (TTL < 10s):** skip Tier 0 telemetry entirely. Hit rate will be near-zero. Flag as "not Soma-Check candidate" in dashboard.

**Provider opts out of shadow mode:** respect it. Disable telemetry for that provider's endpoints. Document reason, revisit in 6 months.

**Provider leaves ClawNet:** all Soma Check telemetry stops. Shadow-mode data retained per data retention policy. No further billing.

**Rate-limited free-tier origin APIs:** shadow mode doesn't increase origin call volume (it's passive observation of existing traffic). Safe even under strict rate limits.

**Hash mismatch during delivery (race condition):** origin wins. Serve origin response, log mismatch event, flag for investigation. Agent gets full data + full charge.

---

## Metrics per tier

| Metric | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| Projected hit rate | ✓ | — | — | — |
| Actual hit rate | — | ✓ | ✓ | ✓ |
| Revenue from hits | — | ✓ | ✓ | ✓ |
| Vouch rank | — | — | ✓ | ✓ priority |
| Referred providers | — | — | — | ✓ |
| Co-marketing exposure | — | — | — | ✓ |

---

## Related docs

- `internal/soma-check-strategy.md` — overall strategy
- `internal/soma-check-billing.md` — billing math per tier
- `internal/soma-check-header-spec.md` — HTTP contract
