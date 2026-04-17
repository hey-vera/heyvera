# Soma Integration — Identity & Verification

Status: canonical

Current-main note: this document previously mixed target architecture and
older/fork-era trust-network claims with shipped runtime truth. For the
verified current-main status of Soma and trust surfaces, see
[`docs/reference/current-trust-surfaces.md`](./current-trust-surfaces.md).
Any section below that names a file absent from that status page is proposal or
historical context until a fresh PR supplies source, tests, and updated docs.


Soma is the core identity and provenance protocol. Soma provides **cryptographic accountability**: every paid interaction is bound to a key, timestamp, and heartbeat chain. Proof of origin — "this data came from this key, at this time, processed through this heart" — is the guarantee we make.

**What Soma is NOT:** Soma does not prove data is *factually true*. A malicious provider can sign wrong numbers and the birth certificate will be cryptographically valid. What Soma gives you is attribution — a provider cannot later deny what they signed, and an observer can always trace data back to its signer. From a *trusted* source, proof of origin is effectively proof of truth; from an untrusted source, it's the evidence you need to hold them accountable.

**Soma repo:** `C:\Users\Josh\Desktop\GitHub\Soma` ([github.com/1xmint/Soma](https://github.com/1xmint/Soma))

**Two components:**
- **soma-heart** (agent side, production) — execution runtime, credential vault, birth certificates, heartbeat chain, per-token HMAC
- **soma-sense** (observer side, experimental) — 10 sensory channels including temporal/topology/vocabulary fingerprinting, phenotype atlas, behavioral verdicts (GREEN/AMBER/RED/UNCANNY). The fingerprinting layer is **experimental research** based on limited published data (one IEEE paper reporting ~93% accuracy on cloud inference), not yet proven adversarially robust. Treat sense verdicts as advisory signals, not primary security controls.

**Strategic direction:** ClawNet makes itself verifiable. ClawNet runs the heart. Callers run the sense (if they want behavioral advisory signals). ClawNet does NOT verify itself — self-verification = self-attestation. The observer must be a separate party.

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

**Provider Umbrella:** x402 providers register endpoints via `POST /v1/providers/register` (self-service, any API key holder) or `POST /v1/providers` (admin). They get smart caching, Soma provenance, PQ signatures, EAS receipts, and shared-cache flywheel. Provider-scoped API keys restrict access to owned endpoints only.

**Revenue share:** 90% provider / 10% platform on live calls. Cache hits = 0% provider (server not touched). Configurable per-provider via `revenue_share_pct`.

**Two modes:**
- **Proxy mode** (default) — traffic routes through ClawNet, gets caching + Soma signing (+10-30ms latency)
- **Verify mode** — agent calls provider directly, submits cert to `POST /v1/soma/verify` for async verification (zero latency)

**Key files:**
- `src/db/providers.ts` — `createProvider()`, `registerProviderEndpoint()`, `recordProviderCall()`, `creditProviderShare()`, analytics
- `src/routes/providers.ts` — 13 REST endpoints including self-service registration
- `src/routes/soma.ts` — `POST /v1/soma/verify` — verify mode endpoint
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

## Phase 7 — Soma Check Protocol (built)

First conditional payment protocol for APIs. Agents check a content hash before paying — if data hasn't changed, they pay nothing. Built on the existing birth-certificate `dataHash`, so the primitive that proves provenance also drives change detection.

**Why it's in Soma:** No protocol (x402, ACP, AP2, L402) has conditional payments. The birth certificate's `dataHash` is content-addressed, so reusing it costs zero extra crypto. One hash, two capabilities.

**Flow:**
```
1. Agent → GET /v1/endpoints/:id/check          → { dataHash, fresh, age } (FREE)
2. Agent → POST /v1/endpoints/:id/call
           + If-Soma-Hash: <previous_hash>
   a. Hash MATCHES cache → { unchanged: true }   (0 credits)
   b. Hash DIFFERS        → normal x402 flow      (full price, new dataHash returned)
   c. No header           → normal x402 flow      (backward compatible)
```

**Response headers (on every call):**
- `X-Soma-Hash` — data content hash
- `X-Soma-Protocol: soma-check/1.0`

Agents store the hash and send it as `If-Soma-Hash` on subsequent calls. Backward compatible — agents that don't know about Soma Check just pay normally.

**Key files:**
- `src/routes/endpoints.ts` — `GET /:id/check` (free hash probe), `If-Soma-Hash` header on `POST /:id/call`
- `src/core/cache-certificate.ts` — `getCacheHashInfo()` lightweight hash lookup (no served-count bump)
- `src/core/provider-cache-warm-cron.ts` — warming cron uses hash compare to skip re-cache on unchanged data

**Soma Check in soma-heart (provider side):** Providers running soma-heart expose a hash-only endpoint that returns the birth certificate `dataHash` without re-running the full fetch. Upstream of ClawNet, this cascades: agents can do hash-only probes all the way to the origin provider.

**Soma Check in soma-sense (consumer side):** `smartFetch()` helper wraps `fetch()`, tracks dataHash per URL, automatically sends `If-Soma-Hash` on subsequent calls, and returns cached data on `unchanged: true` responses. Zero effort for the agent developer.

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
