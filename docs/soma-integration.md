# Soma Integration — Identity & Verification

Soma is the core identity and verification protocol. Proves identity through physics: temporal fingerprinting of model inference + per-token HMAC authentication. You can't fake Claude's inference rhythm without running Claude.

**Soma repo:** `C:\Users\Josh\Desktop\GitHub\Soma` ([github.com/1xmint/Soma](https://github.com/1xmint/Soma))

**Two components:**
- **soma-heart** (agent side) — execution runtime, credential vault, birth certificates, heartbeat chain, per-token HMAC
- **soma-sense** (observer side) — temporal/topology/vocabulary fingerprinting, phenotype atlas, behavioral verdicts (GREEN/AMBER/RED/UNCANNY)

**Strategic direction:** ClawNet makes itself verifiable. ClawNet runs the heart. Callers run the sense (if they want behavioral verification). ClawNet does NOT verify itself — self-verification = self-attestation. The observer must be a separate party.

**On-chain identity:** Three ERC-8004 registrations on Base Mainnet:
- **36119** — ClawNet
- **37696** — Soma protocol
- **36118** — AID Protocol (legacy, abandoned)

## Phase 1 — Data Provenance (built)

ClawNet uses `heart.fetchData()` for outbound x402 API calls. Every call gets a birth certificate (data hash + Ed25519 signature + heartbeat chain entry). This proves "I called this URL, got this data, here's the hash."

**Key bridging:** Derives soma keypair from `PLATFORM_SIGNING_SECRET` via SHA-256 seed (`src/utils/ed25519-signer.ts`).

**Integration points:**
- `src/core/soma.ts` — `initHeart()`, `getHeart()`, `getHeartSafe()`, `destroyHeart()`, `heartLlmComplete()`
- `src/providers/clawapis.ts` — `clawApiCall()` wraps fetch in `heart.fetchData()`, birth certificate via `getLastBirthCertificate()`
- `src/core/executor.ts` — `StepResult.birthCertificate`, `ExecutionResult.birthCertificates`
- `src/routes/api.ts` — `POST /v1/orchestrate` response includes `provenance` field when certificates exist
- `src/routes/well-known.ts` — `GET /.well-known/soma.json` exposes genome, DIDs, heartbeat chain status
- `src/middleware/soma-provenance.ts` — `X-Soma-*` headers on all orchestration + x402 responses

## Phase 2 — Model Verification (built)

ClawNet's own LLM calls (`parseIntent()`, `formatResponse()`, etc.) route through `heart.generate()` via `heartLlmComplete()`. Every `llmComplete()` call tries the heart first, falls back to direct SDK if unavailable.

This gives ClawNet's internal LLM calls:
- Per-token HMAC authentication (cryptographic proof per token)
- Heartbeat chain entries (tamper-evident computation log)
- Generation provenance in response headers (`X-Soma-Model-Verified`, `X-Soma-Token-Count`, etc.)

**MCP verification:** `src/mcp/soma-mcp-wrapper.ts` embeds Soma metadata (genome commitment + ephemeral X25519 public key) in MCP initialize response. Callers running soma-sense can verify via encrypted channel.

**Key distinction:** Data provenance (birth certificates) ≠ model verification (sense verdicts). Never conflate them.

## Phase 3 — On-Chain Anchored Verdicts (built)

Soma verdict infrastructure anchors verification outcomes on-chain via Merkle trees + Solana memo.

**DB tables (v122 migration):** `soma_verdicts`, `soma_verdict_stats`, `soma_verdict_anchors`
**Domain module:** `src/db/soma-verdicts.ts` — `recordSomaVerdict()`, `getSomaVerdictStats()`, `getRecentSomaVerdicts()`, anchor lifecycle

**Routes (`src/routes/soma.ts`):**
- `POST /v1/soma/verdicts` — submit verdict (Ed25519 signature verified, self-verdicts blocked, dual rate limited by IP + DID)
- `GET  /v1/soma/:did/trust` — public "credit bureau" endpoint (free, no auth)
- `GET  /v1/soma/:did/verdicts` — recent verdicts for an agent
- `GET  /v1/soma/:did/export` — portable trust chain with per-verdict Merkle proofs (rate limited)
- `GET  /v1/soma/anchors/:id` — anchor details (Solana tx hash, tree)

**Cron (`src/core/soma-anchor-cron.ts`):** Periodically builds Merkle tree from unanchored verdicts, sends Solana memo with root. Uses existing `MERKLE_ANCHOR_ENABLED` flag. ~$0.024/day.

## Phase 4 — Soma Receipt Layer (built)

Cryptographic receipts for every paid ClawNet interaction. Binds payment proof + request hash + response hash + birth cert + heartbeat index into one verifiable artifact. Uses EAS (Ethereum Attestation Service) on Base for ecosystem-standard attestations.

**Schema:** Registered on Base EAS — UID `0xf40dd2ae45c1db6e1facfdf188598fd5b7c74da7f1a25570f3dd3732258b610b` ([view on EASScan](https://base.easscan.org/schema/view/0xf40dd2ae45c1db6e1facfdf188598fd5b7c74da7f1a25570f3dd3732258b610b))

**Receipt creation (all paths):**
- `src/routes/stripe.ts` — Stripe credit purchase → Soma Receipt (fire-and-forget)
- `src/routes/solana.ts` — Solana USDC purchase → receipt in API response
- `src/routes/api.ts` — Credit-based orchestration → receipt (fire-and-forget)
- `src/routes/endpoints.ts` — Direct endpoint call → receipt with birth cert data
- `src/routes/x402-skills.ts` — x402 skill + orchestrate → receipt in response body

**Public verification:**
- `GET /v1/soma/receipt/:id` — public receipt lookup (no auth)
- `GET /v1/soma/receipts/stats` — receipt statistics
- `GET /v1/account/soma-receipts` — authenticated receipt list for dashboard
- `site/verify.html` — paste receipt ID, see full verification details
- EASScan: each receipt with EAS attestation is browsable at `base.easscan.org`

**On-chain anchoring:** `src/core/eas-anchor-cron.ts` — hourly Merkle-root timestamp on Base via EAS (~$0.001/batch). Dual anchoring: Base (EAS) + Solana (memo for verdicts).

**Dashboard:** Receipts tab shows paginated list with payment method badges, provenance status, anchor status, View + EAS verify links. Success page shows receipt card after Stripe checkout.

**x402 agents (no account):** Receipt returned in response body with `receipt.id`, `receipt.verifyUrl`, `receipt.easScanUrl`. Verify anytime at public endpoint.

**Post-quantum ready:** `PQ_SIGNATURES_ENABLED` flag enables hybrid Ed25519 + ML-DSA-65 (FIPS 204) dual signatures on all receipts. Uses `@noble/post-quantum` (portable JS). Domain-separated key derivation: `SHA-256(secret + ':ml-dsa-65')`. Both signatures must pass (AND rule). Upgrade to Node 24 native `crypto.sign('ml-dsa-65')` when available (~Oct 2026).

## Phase 5 — Dual-Signed Soma + Provider Umbrella (built)

x402 providers running Soma heart produce their own birth certificates. ClawNet validates the provider's certificate, then co-signs with the platform key, creating an unbroken chain of custody.

**Dual-sign flow:**
1. Provider calls upstream API via `heart.fetchData()` → birth cert #1 (provider signature)
2. ClawNet receives data + provider `X-Soma-*` headers
3. `extractProviderCert()` reads provider cert from headers
4. `verifyProviderCert()` validates provider's Ed25519 signature
5. `createDualSign()` creates chain hash binding both certs, platform co-signs
6. Response carries both certs: `X-Soma-Provider-*` + `X-Soma-*` (platform)

**Key files:**
- `src/core/dual-sign.ts` — `createDualSign()`, `verifyDualSign()`, `extractProviderCert()`
- `src/core/dual-sign-state.ts` — request-scoped state for middleware pickup
- `src/middleware/soma-provenance.ts` — emits dual-sign headers when available

**Response headers (dual-signed):**
- `X-Soma-Dual-Signed: true`
- `X-Soma-Chain-Hash` — binds provider + platform certs together
- `X-Soma-Provider-Verified` — whether provider cert passed verification
- `X-Soma-Provider-Data-Hash`, `X-Soma-Provider-Signature`, `X-Soma-Provider-Public-Key`
- Standard `X-Soma-Data-Hash`, `X-Soma-Signature`, `X-Soma-Public-Key` (platform)

**Provider Umbrella:** x402 providers register endpoints with ClawNet via `POST /v1/providers`. They get smart caching, Soma provenance, PQ signatures, EAS receipts, and shared-cache flywheel. Provider-scoped API keys restrict access to owned endpoints only.

**Key files:**
- `src/db/providers.ts` — `createProvider()`, `registerProviderEndpoint()`, `recordProviderCall()`, analytics
- `src/routes/providers.ts` — 11 REST endpoints for provider management
- `src/middleware/auth.ts` — `checkProviderScope()` enforces provider endpoint ownership

## Phase 6 — zkTLS Verification (built, opt-in)

Proves at the TLS layer that upstream API data came from the claimed server. Uses Reclaim Protocol's attestor network. Closes the trust gap where someone could argue ClawNet or the provider fabricated birth certificates.

**Five-layer trust stack (complete):**
1. **zkTLS** (Reclaim Protocol) — proves data came from server's TLS certificate
2. **Provider Soma cert** — proves provider processed it authentically
3. **Platform Soma cert** — proves platform relayed without tampering
4. **PQ hybrid signature** (Ed25519 + ML-DSA-65) — quantum-resistant durability
5. **EAS on-chain anchor** — immutable public record on Base

**Opt-in:** Per-call `{ "zktls": true }` or per-endpoint registry flag. Adds ~200-500ms latency.

**Key files:**
- `src/core/zktls.ts` — `zkTlsFetch()`, `verifyZkTlsProof()`, `isZkTlsEnabled()`
- DB: `zktls_proofs` table, linked to `soma_receipts.zktls_proof_id`
- Env: `ZKTLS_ENABLED`, `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`

**Dependencies (optional):** `@reclaimprotocol/zk-fetch`, `@reclaimprotocol/js-sdk`. Lazy-loaded — if not installed, zkTLS is silently disabled.

## Client SDK Integration

Soma trust features are exposed through all ClawNet SDK packages:

```typescript
// Verify any receipt (public, no auth)
const receipt = await ClawNet.verifyReceiptPublic('sr-abc123');
console.log(receipt.algorithm);     // 'Ed25519+ML-DSA-65'
console.log(receipt.easScanUrl);    // EAS attestation link
console.log(receipt.dualSign);      // provider dual-sign data (if present)

// Trust lookup (public, no auth)
const trust = await ClawNet.getTrust('did:web:api.example.com');
console.log(trust.trustScore);      // 0-100
console.log(trust.verdict);         // GREEN/AMBER/RED/UNCANNY
```

All framework integrations (LangChain, OpenAI Agents, Vercel AI, AgentKit, ElizaOS) include a `clawnet_verify_receipt` tool for agent-accessible verification.

Published npm packages:
- `soma-heart` (0.1.1) — provider-side execution runtime
- `soma-sense` (0.1.0) — observer-side verification, includes `verifyClawNetReceipt()`

## Shared Crypto Primitives

| File | What |
|------|------|
| `src/utils/ed25519-signer.ts` | Ed25519 keypair + ML-DSA-65 hybrid signing from `PLATFORM_SIGNING_SECRET` |
| `src/utils/jcs.ts` | JCS canonicalization (RFC 8785), base58btc encode/decode |
| `src/utils/crypto-agility.ts` | `somaHash()`, ML-DSA-65 dispatch, algorithm negotiation, PQC migration |
| `src/core/merkle-anchor.ts` | Merkle tree build/verify for verdict + receipt anchoring |
