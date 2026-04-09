# Identity Verification Tiers — Agent Operator Verification

Third trust axis alongside behavioral scoring and proof tiers.
Proves the human behind an agent is real, unique, and verified.

**v2 (2026-04-09):** Upgraded to **composite identity scoring** — peak identity requires
convergence across 5 independent signals (biometric, KYC, passport, behavioral, social).
Single iris scan alone gives 0.35/1.0 instead of 1.0/1.0. See `backlog/composite-identity-scoring.md`
for the full design and future phases (wallet linking, sybil curves, identity detachment).

## Three Axes of Trust

```
effectiveTrust = behaviorScore * proofMultiplier * identityMultiplier
```

| Axis | What it proves | Existing |
|------|---------------|----------|
| Behavioral | Agent acts honestly (6 dimensions) | Yes |
| Proof | Actions are cryptographically verifiable (Nova/Groth16) | Yes |
| Identity | A real verified human operates this agent | **Building now** |

## Identity Tiers

| Tier | Multiplier | Signal | Provider |
|------|-----------|--------|----------|
| `biometric` | 1.0 | Iris-verified unique human | World AgentKit (Orb) |
| `kyc-attested` | 0.9 | Verified Coinbase trading account | Coinbase Verifications (EAS on Base) |
| `passport` | 0.8 | ML humanity score from on-chain behavior | Human Passport (human.tech) |
| `anonymous` | 0.65 | No identity verification | Default |

Blended formula (same as proof tier): `0.5 + 0.5 * multiplier`
- biometric: 1.0
- kyc-attested: 0.95
- passport: 0.9
- anonymous: 0.825

## Integration Paths

### 1. World AgentKit (Biometric Tier)
- `npm install @worldcoin/agentkit`
- Ships as Hono middleware: `createAgentkitHooks()` + `agentkitResourceServerExtension`
- Agent registration: `npx @worldcoin/agentkit-cli register <wallet>`
- Triggers World App verification (iris biometrics via Orb)
- Registration recorded on AgentBook smart contract (Worldchain)
- Networks: Worldchain (eip155:480), Base (eip155:8453)
- x402-native: extends x402 to require proof-of-human alongside payment

### 2. Coinbase Verifications (KYC-Attested Tier)
- EAS attestations on Base mainnet — already live
- Coinbase Attester: `0x357458739F90461b99789350868CD7CF330Dd7EE`
- Coinbase Indexer: `0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C`
- Schema UID (Verified Account): `0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9`
- Query: call Indexer with recipient address + schema UID
- ClawNet already uses EAS for Soma receipts — same infrastructure

### 3. Human Passport (Passport Tier)
- Free API at `https://api.passport.xyz/`
- Returns Humanity Score (numeric, e.g. 25.0)
- Threshold: score >= 20 = verified human
- 2M+ users, ML Sybil detection on Base
- No biometrics needed — analyzes on-chain behavior patterns

## DB Schema

```sql
-- Migration v186
CREATE TABLE IF NOT EXISTS agent_identity_verification (
  agent_did TEXT PRIMARY KEY,
  identity_tier TEXT NOT NULL DEFAULT 'anonymous'
    CHECK(identity_tier IN ('biometric', 'kyc-attested', 'passport', 'anonymous')),
  provider TEXT,                    -- 'world', 'coinbase', 'human-passport'
  verification_hash TEXT,           -- H(verification data) for audit
  verified_at TEXT,
  expires_at TEXT,                  -- Verifications can expire
  wallet_address TEXT,              -- Linked wallet (for on-chain checks)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## API Endpoints

```
POST /v1/identity/verify/world      — Submit World AgentKit verification
POST /v1/identity/verify/coinbase   — Submit wallet for Coinbase attestation check
POST /v1/identity/verify/passport   — Submit wallet for Human Passport check
GET  /v1/identity/:did              — Get identity tier for an agent
```

## Trust Oracle Integration

In `queryTrust()`:
```typescript
const identityTier = getIdentityTier(agentDid);
const identityMultiplier = 0.5 + 0.5 * IDENTITY_TIER_MULTIPLIER[identityTier];
const effectiveTrust = Math.round(trustScore * proofBlended * identityMultiplier);
```

## Anti-Sybil Impact

| Attack | Before | After |
|--------|--------|-------|
| 10 fake agents | 100 credits (MIN_STAKE=10) | Need 10 iris scans (impossible) |
| Self-vouch ring | Circular discount 50% | Unverified agents get 0.825x cap |
| Observer self-verify | 33% green cap | Biometric agents get priority routing |

This is the ultimate Sybil defense: one human = one biometric verification.
