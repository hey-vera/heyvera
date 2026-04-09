# Soma Fee Spine — Unified Transparent Fee System

Every credit that flows through ClawNet passes through a single transparent breakdown
that becomes a pulse tree ECONOMIC leaf — auditable, on-chain, verifiable.

**One function. One formula. Every fee proven. Even zero fees.**

## The Three Principles

### 1. Infrastructure Rate (one percentage, trust-scaled)

When someone else provides value through ClawNet (marketplace skill, provider endpoint,
cache hit), ClawNet takes an infrastructure cut for hosting, billing, trust oracle,
Soma provenance, discovery, and escrow management.

```
infrastructureFee = amount * BASE_RATE * trustMultiplier(agentTrust)
```

| Trust Score | Multiplier | Effective Rate | On 100cr |
|-------------|-----------|----------------|----------|
| 0-20 (new) | 1.00 | 5.0% | 5.00 cr |
| 20-40 (building) | 0.85 | 4.25% | 4.25 cr |
| 40-60 (established) | 0.70 | 3.5% | 3.50 cr |
| 60-80 (trusted) | 0.55 | 2.75% | 2.75 cr |
| 80-90 (verified) | 0.45 | 2.25% | 2.25 cr |
| 90+ (sovereign) | 0.40 | 2.0% | 2.00 cr |

BASE_RATE = 0.05 (5%)

**Why 5% is justified:**
- API gateway (serving, load balancing, DDoS)
- Billing infrastructure (Stripe, USDC, fraud prevention)
- Trust oracle (6-dimension behavioral scoring)
- Soma provenance (heart folding, birth certs, pulse tree persistence)
- Marketplace (discovery, search, ranking)
- Escrow + dispute resolution

**Why trust reduces it:**
- High-trust agents cost less to serve (fewer fraud checks, batched settlement)
- They bring more value to the ecosystem
- Natural incentive to build trust

### 2. Products Priced Transparently

ClawNet's own products have fixed, published pricing:

| Product | Price | Note |
|---------|-------|------|
| Orchestration (routing) | FREE | Discovery is infrastructure, not product |
| Basic trust query | FREE | Ecosystem safety baseline |
| Dimensional trust query | 0.03 cr | 6-dimension scoring + compute |
| Full trust query | 0.05 cr | Merkle proofs + behavioral summary |
| Groth16 proof | 25 cr | Real ZK compute (first/month free) |
| Data custody events | FREE | Soma primitive |

### 3. Zero Hidden Fees

| Old Fee | New | Why |
|---------|-----|-----|
| Transfer fee (1%) | FREE | Encourage agent economy |
| Payout spread (25%) | Actual tx costs only | Zero platform margin on payouts |
| Surge pricing (5x max) | Eliminated | Trust-gated priority instead |
| Swarm base fee (20 cr) | FREE | Multi-agent is the future |
| Orchestration fee (2 cr) | FREE | Funnel, not product |

Payouts show exact costs:
```
Payout: 10,000 credits
  Credit value:      $10.00
  Solana tx fee:     -$0.001
  You receive:       $9.999 USDC
  Platform margin:   $0.00
```

## The Proof System

**Every economic event gets a fee breakdown leaf — INCLUDING zero-fee events.**

This is the difference between "trust us" and "verify us."

### Breakdown Leaf Structure

```typescript
interface FeeBreakdown {
  version: 'v1';
  type: string;           // 'endpoint_call' | 'cache_hit' | 'skill_invoke' | 'transfer' | 'trust_query'
  amount: number;         // total credits charged
  providerShare: number;  // credits to provider/creator
  platformFee: number;    // credits to ClawNet
  platformRate: number;   // the rate applied (0.0 - 0.05)
  trustScore: number;     // agent's trust at time of transaction
  trustMultiplier: number;// the multiplier applied
  formula: string;        // 'infrastructure_v1' | 'product_fixed' | 'zero_fee'
}
```

### Examples

**Endpoint call (new agent, trust 15):**
```json
{
  "version": "v1",
  "type": "endpoint_call",
  "amount": 2.0,
  "providerShare": 1.9,
  "platformFee": 0.1,
  "platformRate": 0.05,
  "trustScore": 15,
  "trustMultiplier": 1.0,
  "formula": "infrastructure_v1"
}
```

**Cache hit via Soma Check (trusted agent, trust 85):**
```json
{
  "version": "v1",
  "type": "cache_hit",
  "amount": 0.2,
  "providerShare": 0.1955,
  "platformFee": 0.0045,
  "platformRate": 0.0225,
  "trustScore": 85,
  "trustMultiplier": 0.45,
  "formula": "infrastructure_v1"
}
```

**Transfer (zero fee, still proven):**
```json
{
  "version": "v1",
  "type": "transfer",
  "amount": 500.0,
  "providerShare": 500.0,
  "platformFee": 0.0,
  "platformRate": 0.0,
  "trustScore": 42,
  "trustMultiplier": 0.0,
  "formula": "zero_fee"
}
```

**Soma Check cache hit (provider gets 100%, platform gets 0%):**
```json
{
  "version": "v1",
  "type": "soma_check_hit",
  "amount": 0.15,
  "providerShare": 0.15,
  "platformFee": 0.0,
  "platformRate": 0.0,
  "trustScore": 55,
  "trustMultiplier": 0.0,
  "formula": "zero_fee"
}
```

Every leaf is hashed into the pulse tree, included in monthly Groth16 proofs,
and anchored on-chain via EAS on Base. Agents can audit any transaction.
ClawNet can never overcharge without it showing in the proof.

## Progressive Creator Split

The infrastructure rate replaces the flat 90/10 split. Creators get
`amount - infrastructureFee`. At 5% base rate, that's 95% to creator.
At 2% (sovereign trust), that's 98% to creator.

Additionally, progressive kickstart for new creators:

| Creator Monthly Revenue | Override | Platform Cut |
|------------------------|----------|-------------|
| First $100/month | 0% | Zero — onboarding incentive |
| $100-$1,000/month | Standard rate | 2-5% (trust-scaled) |
| $1,000+/month | Standard rate | 2-5% (trust-scaled) |

## Public Fee Formula Endpoint

```
GET /v1/fees/formula → published formula, versioned, auditable
GET /v1/fees/audit/:did → all fee breakdowns for an agent (pulse tree query)
```

## Onboarding Sweeteners

| Incentive | Amount | Trigger |
|-----------|--------|---------|
| Free trial credits | 100 | Account creation |
| First Groth16 proof | Free | Once per agent per month |
| Trust milestone bonus | 500 credits | Agent reaches 80+ trust |
| Creator kickstart | 500 credits | First skill published |
| Referral (receiver) | 1,000 credits | Uses referral code |
| Referral (sender) | 500 credits | Referral signs up |
| USDC bonus | +7% | Pay with USDC (no Stripe fees) |

## Migration Path

The fee spine replaces these scattered constants:
- `REVENUE_SHARE = 0.90` in creator-tools.ts
- `TRANSFER_FEE_PCT = 0.01` in transfers.ts
- `ORCHESTRATION_FEE = 2` in config/index.ts
- `SOMA_CHECK_HIT_PRICE_RATIO = 0.10` in soma-check-billing.ts
- `AID_TRUST_TIERS` discount table in credits.ts
- `PAYOUT_USDC_PER_CREDIT = 0.00075` in config/index.ts
- Surge pricing cap (5x) in credits.ts
- `SWARM_BASE_FEE = 20` in config/index.ts

All replaced by one function: `computeFeeBreakdown()` in `src/core/fee-spine.ts`.
