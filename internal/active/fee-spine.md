# Soma Fee Spine — Additive Transparent Fee System

Two-layer architecture:
- **Soma Economic Protocol** (`soma-economics.ts`) — platform-agnostic schema, recording, verification
- **ClawNet Fee Spine** (`fee-spine.ts`) — ClawNet's specific additive formula

**One formula. Additive model. Every fee proven. Even zero fees.**

## Architecture: Soma Protocol vs ClawNet Business Logic

### Soma Economic Protocol (open source, any platform)

Standard schema for economic events. Any platform can prove fair fees:

```typescript
interface SomaFeeBreakdown {
  schemaVersion: string;           // '1.0'
  platform: string;                // Platform identifier (DID, name)
  eventType: string;               // Platform-defined event type
  amount: number;                  // Total charged to agent
  recipientShare: number;          // Amount to service provider
  platformFee: number;             // Amount kept by platform
  formulaId: string;               // Published formula identifier
  formulaInputs: Record<string, number>; // All inputs (transparent, recomputable)
  hash: string;                    // H(breakdown) → ECONOMIC leaf in pulse tree
}
```

Functions: `hashFeeBreakdown()`, `verifyFeeBreakdown()`, `recordEconomicEvent()`

**What this enables:** Agents compare fees across platforms using the same schema. Auditors verify any charge by recomputing from `formulaInputs`. Platforms compete on fee transparency.

### ClawNet Fee Spine (our implementation)

ClawNet's specific formula using the Soma schema. Formula ID: `clawnet-additive-v1`.

## The Additive Model

Provider gets 100% of their price. Platform fee is added ON TOP. Never carved from the total.

```
agentPays = providerPrice + (providerPrice × baseRate × trustMultiplier)
```

| Trust Score | Multiplier | Effective Rate | On 1.0cr endpoint |
|-------------|-----------|----------------|-------------------|
| 0-20 (new) | 1.00 | 5.0% | Agent pays 1.05cr (provider: 1.0, platform: 0.05) |
| 20-40 | 0.85 | 4.25% | Agent pays 1.0425cr |
| 40-60 | 0.70 | 3.5% | Agent pays 1.035cr |
| 60-80 | 0.55 | 2.75% | Agent pays 1.0275cr |
| 80-90 | 0.45 | 2.25% | Agent pays 1.0225cr |
| 90+ (sovereign) | 0.40 | 2.0% | Agent pays 1.02cr |

**Why additive:**
- Provider ALWAYS covers their costs (gets 100% of declared price)
- Agent sees exactly what goes where (providerPrice + platformFee)
- No hidden markup — COST_MARKUP_FACTOR = 1000 (1:1 raw cost)
- Platform fee is justified: hosting, billing, trust, Soma, marketplace

**Why trust reduces it:**
- High-trust agents cost less to serve (fewer fraud checks, batched settlement)
- They bring more value to the ecosystem
- Natural incentive: use Soma → build trust → pay less → use more Soma

## Products Priced Transparently

| Product | Price | Note |
|---------|-------|------|
| Orchestration (routing) | FREE | Discovery is infrastructure |
| Basic trust query | FREE | Ecosystem safety baseline |
| Dimensional trust query | 0.03 cr | 6-dimension scoring + compute |
| Full trust query | 0.05 cr | Merkle proofs + behavioral summary |
| Groth16 proof | 25 cr | Real ZK compute (first/month free) |
| Data custody events | FREE | Soma primitive |

## Zero Hidden Fees

| Item | Fee | Why |
|------|-----|-----|
| Transfers | FREE | Agent-to-agent movement is infrastructure |
| Orchestration | FREE | Discovery is a funnel, not a product |
| Swarm coordination | FREE | Multi-agent is the future |
| Custody events | FREE | Soma primitive |
| Deposits | FREE | No charge to buy credits |
| Payout spread | 5% | Covers Stripe fees + blockchain tx costs only |

## The Proof System

Every economic event — including zero-fee events — gets an ECONOMIC leaf.

### Breakdown Example (Additive)

**Endpoint call (new agent, trust 15, provider charges 2.0cr):**
```json
{
  "schemaVersion": "1.0",
  "platform": "clawnet",
  "eventType": "endpoint_call",
  "amount": 2.1,
  "recipientShare": 2.0,
  "platformFee": 0.1,
  "formulaId": "clawnet-additive-v1",
  "formulaInputs": {
    "providerPrice": 2.0,
    "trustScore": 15,
    "baseRate": 0.05,
    "multiplier": 1.0,
    "effectiveRate": 0.05
  },
  "hash": "a7f3..."
}
```

**Transfer (zero fee, proven):**
```json
{
  "schemaVersion": "1.0",
  "platform": "clawnet",
  "eventType": "transfer",
  "amount": 500.0,
  "recipientShare": 500.0,
  "platformFee": 0.0,
  "formulaId": "clawnet-additive-v1",
  "formulaInputs": { "amount": 500, "trustScore": 42 },
  "hash": "b2e9..."
}
```

Anyone can verify: recompute hash from the breakdown fields, check it exists as an ECONOMIC leaf in the agent's pulse tree.

## Pricing Model

### COST_MARKUP_FACTOR = 1000 (raw cost)

Endpoints are auto-priced at 1:1 raw API cost:
- $0.001 endpoint → 1.0 credits (provider's price)
- Agent pays: 1.0 + 5% infra = 1.05 credits
- Provider gets: 1.0 credits (100% of their cost)
- Platform gets: 0.05 credits

Providers who want margin set explicit `creditCost`. The market decides pricing — not a blind multiplier.

### Payout: $0.00095/credit (5% spread)

Covers real costs only:
- Stripe buy-side fees: ~3.2% per purchase
- Blockchain tx costs: ~$0.001-0.05 per tx
- 5% spread covers both with minimal buffer
- Zero platform surplus on payouts

### Progressive Creator Split

Infrastructure rate replaces flat splits. Creator gets `providerPrice` (100%).
Platform fee is additive, not carved from creator revenue.

At 5% base: creator keeps 100%, agent pays 105%.
At 2% sovereign: creator keeps 100%, agent pays 102%.

## Public Endpoints

```
GET /v1/fees/formula  → published formula, versioned, auditable
GET /v1/fees/estimate → preview breakdown for hypothetical transaction
```

## What Changed from v1

| v1 (inclusive) | v2 (additive) |
|---------------|---------------|
| COST_MARKUP_FACTOR = 1500 | COST_MARKUP_FACTOR = 1000 |
| Platform fee carved from total | Platform fee added on top |
| Provider gets 95% of agent payment | Provider gets 100% of their price |
| FeeBreakdown (ClawNet-specific) | SomaFeeBreakdown (protocol standard) |
| PAYOUT_USDC_PER_CREDIT = 0.0009 | PAYOUT_USDC_PER_CREDIT = 0.00095 |
| Fee spine is ClawNet-only | Schema is Soma protocol (open source) |
