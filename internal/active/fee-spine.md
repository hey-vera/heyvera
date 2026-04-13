# Soma Fee Spine — Trust-First Proof Layer

Two-layer architecture:
- **Soma Economic Protocol** (`soma-economics.ts`) — platform-agnostic schema, recording, verification
- **ClawNet Fee Spine** (`fee-spine.ts`) — proof layer for all economic events

**Routing is the funnel. Trust is the product. Every event proven. Even free ones.**

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

ClawNet's proof layer using the Soma schema. Formula ID: `clawnet-additive-v1`.

## Trust-First Model

Free routing. Provider gets 100%. Platform takes $0 from routing.

```
Routing:  agentPays = providerPrice (platform fee = 0)
Products: agentPays = productPrice (100% to platform)
```

| Event | Agent Pays | Provider Gets | Platform Gets |
|-------|-----------|--------------|---------------|
| Endpoint call | Raw cost (1.0cr) | 100% (1.0cr) | $0 |
| Cache hit | 5% of live (0.05cr) | 100% (0.05cr) | $0 |
| Trust query (dimensional) | 0.03cr | N/A | 0.03cr |
| Trust query (full) | 0.05cr | N/A | 0.05cr |
| Groth16 proof | 25cr | N/A | 25cr |
| Transfer | Free | 100% | $0 |

**Why free routing:**
- Maximum adoption (no reason NOT to use ClawNet)
- Provider always gets 100% of their price
- COST_MARKUP_FACTOR = 1000 (1:1 raw cost, no markup)
- Platform revenue from trust products, not routing tolls

**Trust multiplier table** (retained for trust product discounts and future use):

| Trust Score | Multiplier | Purpose |
|-------------|-----------|---------|
| 90+ (sovereign) | 0.40 | Lowest trust product costs |
| 60-80 | 0.55 | Moderate discounts |
| 0-20 (new) | 1.00 | Base pricing |

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
- Agent pays: 1.0 credits (no markup, no infra fee)
- Provider gets: 1.0 credits (100%)
- Platform gets: $0 from routing

Providers who want margin set explicit `creditCost`. The market decides pricing.

### Payout: $0.00095/credit (5% spread)

Covers real costs only:
- Stripe buy-side fees: ~3.2% per purchase
- Blockchain tx costs: ~$0.001-0.05 per tx
- 5% spread covers both with minimal buffer
- Zero platform surplus on payouts

### Creator Revenue

Creator gets 100% of their declared price. Platform takes nothing from routing.
Revenue comes from trust products that creators' endpoints generate demand for.

## Public Endpoints

```
GET /v1/fees/formula  → published formula, versioned, auditable
GET /v1/fees/estimate → preview breakdown for hypothetical transaction
```

## What Changed

| v1 (inclusive) | v2 (additive) | v3 (trust-first) |
|---------------|---------------|-------------------|
| COST_MARKUP_FACTOR = 1500 | 1000 | 1000 |
| 5% platform fee (carved) | 5% (additive) | 0% (free routing) |
| Provider gets 95% | 100% | 100% |
| Revenue from routing | Revenue from routing | Revenue from trust |
| FeeBreakdown | SomaFeeBreakdown | SomaFeeBreakdown |
| PAYOUT spread 25% | 10% | 5% |
| No token model | No token model | $CLAWNET trust gas |

## Token Integration

See `internal/active/token-architecture.md` for the full $CLAWNET trust gas model.
The fee spine records SomaFeeBreakdowns that the token smart contract uses to verify
burn demand matches real platform usage. Every burn is provable on-chain.
