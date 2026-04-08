> **ARCHIVED** — Superseded on 2026-04-08
> **Outcome:** Revenue splits changed: providers now get 100% of all routing revenue (live, cache, Soma Check). ClawNet revenue comes only from trust queries. The payment rails (credits, x402, Stripe) described below are still valid.
> **See instead:** `active/revenue-architecture.md`

# Funds Flow — How Money Actually Moves

**Written 2026-04-05.** Answers the question: "if someone uses Soma Check, how does the provider actually receive their cut, and how does ClawNet receive ours?"

---

## The three money paths

ClawNet has **three distinct settlement rails**. Which one fires depends on how the agent paid and what endpoint was called.

### Rail 1: Credits (most common — Stripe/USDC buy-in, credit-ledger spend)

**Agent side:**
1. Agent buys credits via Stripe or sends USDC to the Solana receiving wallet → credits land on their `api_keys.credits` balance
2. Agent calls an endpoint → `deductCredit(key, cost)` burns credits from their balance

**Provider side:**
1. Provider registers via `/v1/providers/register`, linking an API key with a `wallet_address` (bs58 Solana)
2. On every call, `creditProviderShare(endpointId, creditsCharged, { cacheHit, latencyMs })` runs (`src/db/providers.ts:366`)
3. Provider's share (50% cache / 90% origin / 95% Tier 3) is credited to their API key balance via:
   ```sql
   UPDATE api_keys SET credits = credits + ? WHERE key = ?
   ```
4. **Payout cron** runs every 4 hours (`src/core/payout-cron.ts`):
   - Picks up all PENDING `payout_requests`
   - Converts credits → USDC at `PAYOUT_USDC_PER_CREDIT` (default `$0.00075/credit` = 25% below buy rate, arb prevention)
   - Sends USDC to provider's Solana `wallet_address`
   - Minimum $1 per payout (accumulates until threshold)
   - On success: marks `PAID`, records `tx_hash`
   - On failure: marks `REJECTED`, admin can re-queue

**ClawNet side:**
- The 10% platform share is retained in `clawhub-treasury` (internal accounting credit)
- Optionally swept to `TREASURY_SWEEP_WALLET` via the same cron when balance ≥ `TREASURY_SWEEP_MIN` (default 10,000 credits = $10)

### Rail 2: x402 USDC Direct Settlement (new, provider-side)

**Agent side:**
1. Agent constructs EIP-712 signed payment payload → sends `X-Payment` header with request
2. x402 facilitator (Coinbase/PayAI/Skyfire) verifies signature, submits on-chain transfer on Base

**Provider side:**
- USDC lands **directly** on the provider's EVM address on Base (not our wallet)
- No credit intermediary, no payout cron, no delay
- This is the rail used for endpoints that opt into `/v1/x402/skills` direct-pay mode

**ClawNet side:**
- Platform fee is either (a) added on top as a separate transfer, or (b) netted out via `X402_USDC_PER_CREDIT` pricing
- See `src/routes/x402-facilitator.ts` for settle logic

### Rail 3: Stripe (future, not yet wired for providers)

- Stripe Connect transfers to provider's connected account
- Platform keeps application_fee_amount
- Currently only used for agent → platform top-ups, not platform → provider payouts
- Roadmap item, not yet implemented

---

## Who needs to give us what

**Provider onboarding checklist:**

| Field | Why |
|---|---|
| API key | Receives provider credits; links to endpoints they own |
| `wallet_address` (Solana bs58) | Destination for USDC payouts |
| Endpoint list | What they're providing |
| Tier (0-3) | Drives Soma Check split ratio |

That's it. **Provider does NOT need to hold any ClawNet token, sign any contract, or commit any capital.** They register, ship calls, receive USDC every 4 hours.

---

## Is a 10% cut "sketchy or unfair"?

**No. Here's the professionalism case.**

### Industry benchmark

| Platform | Take rate |
|---|---|
| Stripe | 2.9% + $0.30 (payments only, no infra) |
| App Store / Play Store | 15–30% |
| AWS API Gateway | 2–5× markup on underlying services |
| Uber / DoorDash | 15–30% |
| Cloudflare Workers | ~30% on compute |
| Shopify Payments | 2.9% + 30¢ |
| **ClawNet origin call** | **10%** |
| **ClawNet Soma Check hit (Tier 0-2)** | **1%** (10% of 10% origin price) |
| **ClawNet Soma Check hit (Tier 3 Champion)** | **0.5%** |
| **ClawNet L1/L2 cache hit** | **5%** (50% of 10% cache-hit price) |

**Our take rate is below industry norms and drops further with tier advancement or cache economics.**

### Why 10% is justified, not rent-seeking

1. **Real infrastructure** — hash computation, JCS canonicalization, discovery index, receipt anchoring, dispute arbitration, telemetry aggregation, Soma Heart provenance signing, agent identity verification, rate limiting, fraud detection. Not pure toll-taking.

2. **Volume paradox is real** — in the canonical example (agent polling 10×/hr → 50×/hr with Soma Check):
   - Provider revenue: +40% vs no Soma Check
   - Agent spend: +40% but getting 5× more polls
   - ClawNet revenue: +180%
   - Everyone wins because cheap hits change polling economics. Our cut grows with net-new volume we *created*, not cannibalization.

3. **Champion Tier is the escape valve** — any provider can earn their way to 95/5 by hitting volume + referral thresholds. That's an incentive structure, not a lock-in.

4. **Zero lock-in** — Soma Check is standard RFC 9111 HTTP. Provider can leave any day; the protocol still works on their servers without us.

5. **Transparent rates** — all splits documented publicly, telemetry provider-facing via dashboard, payout rates hardcoded in env vars (not dark-pattern dynamic).

6. **Payout trail is auditable** — every `payout_requests` row has a `tx_hash`; providers can verify on-chain.

### Where we could be **more** professional

- [ ] Publish public provider Terms of Service
- [ ] Public rate card on marketing site (currently only in dashboard + docs)
- [ ] Provider-queryable payout ledger API (`GET /v1/providers/:id/payouts`)
- [ ] On-chain receipt for every split (Soma Receipt Layer does this — on roadmap)
- [ ] Audited smart contract for x402 direct-settlement splits
- [ ] Third-party financial audit once monthly volume > $100K

**How to apply:** the "is this sketchy?" question should be answered by pointing at the transparency list above, not by lowering the take rate. 10% funds a full infra stack + trust layer; cutting it starves the things that make ClawNet trustworthy.

---

## Open decisions

- [ ] Should Tier 0 providers (shadow mode, no code change) still get 90% of cache-hit revenue, or a lower rate since they didn't actively opt in? Leaning: 90% — consistency beats nickel-and-diming.
- [ ] Should we offer a provider token stake option for extra discount (e.g., stake $CLAWNET → 93/7 instead of 90/10)? Deferred until token economics finalized.
- [ ] Auto-demote providers from Tier 3 on wallet_address change (potential account takeover signal)?

---

## Related docs

- `docs/billing.md` — ClawNet credit math + existing splits
- `internal/soma-check-billing.md` — Soma Check 90/10 + 95/5 math
- `internal/cache-layers-distinction.md` — why 50/50 vs 90/10 makes sense
- `src/core/payout-cron.ts` — Solana USDC payout implementation
- `src/db/providers.ts` — `creditProviderShare()` per-call split logic
