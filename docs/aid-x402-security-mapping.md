# AID ↔ Agent Autonomy Risk Score — Security Dimension Mapping

Mapping between the [Agent Security Harness](https://github.com/msaleme/red-team-blue-team-agent-fabric) x402 security tests (20 tests, 7 categories, 5 scoring dimensions) and AID Protocol mechanisms.

## Agent Autonomy Risk Score Dimensions

The harness computes a 0-100 risk score from 7 weighted signals. Higher = more dangerous for autonomous agent payments.

| Signal | Weight | What it tests | AID Mechanism |
|--------|--------|---------------|---------------|
| **challenge_invalid** | 20 | Are 402 payment challenge headers valid and complete? | AID's `checkAidProof` middleware validates all identity headers before processing. Provider DID in `PaymentRequired` ensures the challenge comes from a verified source. |
| **inconsistent_recipient** | 25 | Does the payment address change between requests? (dynamic routing attack) | AID binds identity to DID, not wallet. `providerDid` in `PaymentRequired` is cryptographically signed — if the provider DID changes, the proof fails. Mutual authentication catches impersonation. |
| **accepts_invalid_addresses** | 15 | Does the server accept obviously invalid wallet addresses? | Outside AID's scope (payment validation), but AID's trust score reflects historical reliability — a server that accepted bad addresses would have low `successRate` in trust scoring. |
| **accepts_fake_sessions** | 10 | Does the server accept fabricated session tokens? | AID replaces session tokens with per-request cryptographic proofs. Each request has a unique `nonce` + `timestamp` + Ed25519 signature. No session to fabricate — every request is independently verified. |
| **leaks_information** | 10 | Do session tokens or error messages expose sensitive data? | AID proofs are opaque signatures — they contain no wallet addresses, amounts, or keys. Trust scores are 0-100 integers, not raw behavioral data. |
| **no_facilitator_validation** | 15 | Does the agent verify the facilitator's response independently? | AID's mutual authentication requires the server to prove its identity with `providerProof` (Ed25519 signature). The client verifies this cryptographically — not by trusting the facilitator's word. |
| **accepts_underpayment** | 5 | Does the server accept payments below the stated amount? | Outside AID's scope (payment amount validation), but trust-gated pricing (`trustGatedCreditCost`) adjusts prices based on trust score, not arbitrary underpayment. |

## Test Category Mapping

### Category 1: Payment Challenge Validation (X4-001 to X4-003)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-001 | 402 response has all required X-Payment-* headers | AID adds `providerDid` + `signatureAlgorithm` to the challenge — verifiable identity alongside payment headers |
| X4-002 | Malformed payment authorization handling | AID proof validation rejects malformed signatures (base64url decode fails → 401) |
| X4-003 | Unsupported currency negotiation | Not AID's concern — payment mechanism negotiation |

### Category 2: Recipient Address Manipulation (X4-004 to X4-006)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-004 | Dynamic routing detection (address changes between requests) | **Directly addressed.** Provider DID is stable. If provider identity changes, mutual auth proof fails. |
| X4-005 | Payment to wrong recipient | AID doesn't validate payment amounts, but the provider DID binding prevents paying an impersonator |
| X4-006 | Invalid addresses accepted | Not AID's scope — but trust score reflects historical address validation behavior |

### Category 3: Session Token Security (X4-007 to X4-010)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-007 | Session token presence after payment | **AID eliminates this category entirely.** No sessions — every request has a fresh cryptographic proof (DID + nonce + timestamp + Ed25519 signature). |
| X4-008 | Fabricated session token accepted | N/A — no session tokens to fabricate. Per-request proofs. |
| X4-009 | Expired session token accepted | AID has timestamp validation (±5 min window). Stale proofs rejected. |
| X4-010 | Session token leaks sensitive data | AID proofs contain: DID (public), nonce (random), timestamp (public), signature (opaque). No sensitive data exposed. |

### Category 4: Spending Limit Exploitation (X4-011 to X4-013)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-011 | Rapid sequential requests (rate limiting) | AID's trust scoring penalizes burst patterns in the anti-collusion framework. Per-request nonce dedup prevents replay. |
| X4-012 | Underpayment attempt | Not AID's scope (payment validation) |
| X4-013 | Budget exhaustion attack | AID's trust-gated pricing can require higher trust scores for expensive operations — cold-start agents can't exhaust budgets because they start at score 0 |

### Category 5: Facilitator Trust (X4-014 to X4-016)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-014 | Fake facilitator response | **Directly addressed.** AID's mutual authentication requires the server to prove its DID. A fake facilitator can't produce a valid `providerProof` signature. |
| X4-015 | Non-existent facilitator verification | AID trust scores are independently verifiable via `@aidprotocol/trust-compute` — no trust in any single facilitator. |
| X4-016 | Facilitator timeout handling | Not AID's scope (network resilience) |

### Category 6: Information Disclosure (X4-017 to X4-018)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-017 | Payment challenge leaks info | AID's `PaymentRequired` extension contains only public data: provider DID, min trust score, supported methods. No secrets. |
| X4-018 | Error messages expose internals | AID error responses use standardized codes (INVALID_PROOF, EXPIRED_TIMESTAMP, NONCE_REPLAY) — no stack traces or internal state. |

### Category 7: Cross-Chain Confusion (X4-019 to X4-020)

| Test | Description | AID Coverage |
|------|-------------|--------------|
| X4-019 | Wrong network payment | Not AID's scope (chain validation). But `did:key` is chain-agnostic — identity doesn't change across networks. |
| X4-020 | Wrong token type | Not AID's scope (token validation) |

## Summary

| Category | Tests | AID Directly Addresses | AID Indirectly Addresses | Outside AID Scope |
|----------|-------|----------------------|--------------------------|-------------------|
| Payment Challenge | 3 | 2 | 0 | 1 |
| Recipient Manipulation | 3 | 1 | 2 | 0 |
| Session Security | 4 | **4 (eliminates category)** | 0 | 0 |
| Spending Limits | 3 | 1 | 1 | 1 |
| Facilitator Trust | 3 | 2 | 0 | 1 |
| Information Disclosure | 2 | 2 | 0 | 0 |
| Cross-Chain Confusion | 2 | 0 | 0 | 2 |
| **Total** | **20** | **12** | **3** | **5** |

**AID directly addresses 12 of 20 tests (60%), indirectly addresses 3 (15%), and 5 are outside scope (25%).** The 5 outside scope are all payment-mechanism-specific (amount validation, currency negotiation, chain selection) — these are the facilitator's job, not the trust layer's.

The strongest coverage is in **Session Security** — AID eliminates the entire category by replacing sessions with per-request cryptographic proofs. The **Facilitator Trust** category is also well-covered through mutual authentication.
