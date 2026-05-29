# Session A: The Blacksmith's Chain — Provenance Architecture

**Status:** ultra-think brainstorm + architecture draft. NOT a build plan yet.
**Written:** 2026-04-07.
**Research basis:** W3C PROV-DM, PROV-AGENT (arXiv 2508.02866), C2PA v2.2, OpenLineage, IBM Food Trust, Merkle DAG theory, TLSNotary, RISC Zero/SP1 zkVM, TEE attestation (AWS Nitro/Intel TDX), UMA optimistic oracle, codebase analysis of existing Soma birth cert/receipt/delegation/cache cert schemas.
**Depends on:** `verified-data-machine.md` (vision), `golden-plan.md` (strategy), `groundbreaking-extensions.md` (Extension 3: recursive provenance graphs)

---

## 0. What We Have Today

### Current schemas (from codebase analysis):

**BirthCertificate** (simple, flat):
```typescript
{
  dataHash: string;        // SHA-256 of response data
  signature: string;       // Ed25519 over dataHash
  timestamp: string;       // ISO 8601
  publicKey: string;       // Hex Ed25519 pubkey
  heartbeatIndex: number;  // Sequence in heartbeat chain
}
```

**DualSignResult** (two-layer, provider + platform):
```typescript
{
  provider: { dataHash, signature, publicKey, heartbeatIndex };
  platform: { dataHash, signature, heartbeatIndex, publicKey };
  providerVerified: boolean;  // Ed25519 verify
  chainHash: string;          // SHA256 binding both certs
  timestamp: string;
}
```

**CacheCertificate** (binding original → cached):
```typescript
{
  id: string;                 // cc-<nanoid>
  originalCert: { dataHash, signature, publicKey, heartbeatIndex, timestamp };
  cacheCert: { dataHash, cachedAt, freshUntil, servedCount, signature, publicKey };
  chainHash: string;          // JCS-canonical binding
}
```

**SomaReceipt** (full transaction proof):
```typescript
{
  id, requestId, paymentMethod, creditsCost,
  requestHash, responseHash, somaDataHash, heartbeatIndex,
  signature, algorithm, hybridSignature?, easUid, easScanUrl,
  dualSign?: { providerId, providerSignature, providerPublicKey, providerDataHash }
}
```

### What's missing:
- **No `derived_from` field** on any schema — receipts/certs don't reference parents
- **No dependency graph** between receipts — each receipt is standalone
- **Orchestration steps aggregate certs** (`ExecutionResult.birthCertificates[]`) but don't link them in a chain
- **Cache certs bind original→cached** but not cached→subsequent-uses
- **Trust delegation tracks parent→child agents** but not parent→child DATA
- **Skills have `dependencies_json`** for execution graphs but don't create/reference receipts

---

## 1. The Provenance Model

### Mapping Soma to W3C PROV:

W3C PROV has three core types and 10 relationships. Here's how they map:

| PROV Concept | Soma Equivalent | Notes |
|-------------|----------------|-------|
| **Entity** | Data (API response, cached copy, transformed result) | Identified by content hash |
| **Activity** | Operation (API call, transformation, orchestration step) | Identified by receipt ID |
| **Agent** | Provider, Platform, or Consumer Agent | Identified by public key / DID |
| `wasGeneratedBy` | Birth cert proves Activity generated Entity | Signature binds them |
| `used` | Receipt's requestHash shows what Activity consumed | Already tracked |
| `wasDerivedFrom` | **NEW: derivation cert linking output to input** | THE GAP to fill |
| `wasAttributedTo` | Birth cert's publicKey attributes Entity to Agent | Already exists |
| `wasAssociatedWith` | Receipt's api_key_hash links Activity to Agent | Already tracked |
| `actedOnBehalfOf` | Trust delegation (parent→child) | Exists but not linked to certs |
| `wasInformedBy` | **NEW: receipt dependency (this receipt used data from that receipt)** | THE GAP to fill |

### Why W3C PROV is the right vocabulary but not the right format:

PROV gives us the **conceptual model** (Entity/Activity/Agent + relationships). We don't need to adopt PROV-JSON or PROV-JSONLD as our wire format. Reasons:
1. PROV is unsigned — no verification mechanism. We already have signing.
2. PROV is verbose — designed for academic interop, not agent-speed verification.
3. PROV has thin adoption — no major commercial platform uses it natively.
4. PROV doesn't handle trust/verification — just provenance recording.

**Approach: Soma speaks PROV semantics, not PROV syntax.** We map to PROV vocabulary for interoperability (export to PROV-JSON on demand) but our native format is compact, signed, and optimized for agent verification speed.

---

## 2. The Derivation Certificate

### New primitive: `DerivationCert`

This is the core new artifact. It proves: "Output Y was derived from Input(s) X by Agent A running Transformation T."

```typescript
interface DerivationCert {
  // Identity
  id: string;                    // dc-<nanoid>
  version: '1.0';

  // What was produced
  outputHash: string;            // SHA-256 of output data
  outputReceiptId?: string;      // Receipt for this output (if paid)

  // What it was derived from (one or more parents)
  inputs: DerivationInput[];     // Array — supports fan-in (multiple sources)

  // Who did the transformation
  agentPublicKey: string;        // Ed25519 pubkey of transforming agent
  agentDid?: string;             // Optional DID for named agents

  // What transformation was applied
  transformation: {
    type: DerivationType;        // Enum: see below
    description?: string;        // Human-readable (optional)
    codeHash?: string;           // Hash of transformation code (for deterministic replay)
  };

  // Cryptographic binding
  signature: string;             // Ed25519 signature over canonical cert
  timestamp: string;             // ISO 8601
  heartbeatIndex?: number;       // Optional sequencing

  // Provenance metadata
  confidence: ProvenanceConfidence; // How much of the chain is verified
}

interface DerivationInput {
  dataHash: string;              // Hash of input data
  sourceReceiptId?: string;      // Receipt ID (if exists)
  sourceCertId?: string;         // Birth cert or cache cert ID (if exists)
  relationship: 'primary' | 'enrichment' | 'context' | 'parameter';
}

type DerivationType =
  | 'passthrough'     // No transformation (relay/forward)
  | 'filtered'        // Subset of input (selection, redaction)
  | 'aggregated'      // Multiple inputs combined (merge, join)
  | 'computed'         // New data derived from inputs (calculation, analysis)
  | 'enriched'        // Input augmented with additional data
  | 'transformed'     // Structure changed (format conversion, normalization)
  | 'llm_processed'   // LLM was involved (non-deterministic!)
  | 'unknown';        // Transformation not declared

interface ProvenanceConfidence {
  level: 'full' | 'partial' | 'origin_only' | 'unverified';
  verifiedDepth: number;         // How many levels back are verified
  totalDepth: number;            // Total chain depth
  gaps: GapInfo[];               // Where verification breaks
}

interface GapInfo {
  depth: number;                 // Level in chain where gap exists
  reason: 'no_cert' | 'unverified_signer' | 'revoked_signer' | 'expired_cert' | 'unknown_agent';
}
```

### Design decisions:

**1. Array of inputs, not single parent.** Real agent workflows are DAGs, not chains. An enrichment step might combine weather data + financial data + user preferences. Must support fan-in.

**2. Confidence levels, not binary pass/fail.** Every production system (IBM Food Trust, C2PA, supply chain trackers) uses degraded trust for broken chains, not rejection. "This step is unverified" is information, not an error.

**3. `llm_processed` as explicit type.** LLM transformations are non-deterministic. The Machine must distinguish "this was computed deterministically (replayable)" from "this went through an LLM (not replayable)." This matters for dispute resolution — you can prove a deterministic computation was wrong by replay, but you can't prove an LLM response was "wrong."

**4. `codeHash` for deterministic replay.** If the transformation code is known and deterministic, anyone can verify: `hash(T(X)) == outputHash`. This is the cheapest correctness proof available (Option D from research: hash chain).

**5. Relationship types on inputs.** Not all inputs are equal. A "primary" source (the main data) is different from "context" (configuration) or "parameter" (user preference). This matters for attribution and dispute — if the output is wrong, was it the primary data or the enrichment data that caused it?

---

## 3. The Provenance DAG

### Storage: `receipt_derivations` table

```sql
CREATE TABLE receipt_derivations (
  id TEXT PRIMARY KEY,
  cert_json TEXT NOT NULL,           -- Full DerivationCert as JSON
  output_hash TEXT NOT NULL,
  agent_public_key TEXT NOT NULL,
  transformation_type TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  verified_depth INTEGER NOT NULL DEFAULT 0,
  total_depth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE derivation_inputs (
  derivation_id TEXT NOT NULL REFERENCES receipt_derivations(id),
  input_hash TEXT NOT NULL,
  source_receipt_id TEXT,
  source_cert_id TEXT,
  relationship TEXT NOT NULL DEFAULT 'primary',
  PRIMARY KEY (derivation_id, input_hash)
);

CREATE INDEX idx_deriv_output ON receipt_derivations(output_hash);
CREATE INDEX idx_deriv_agent ON receipt_derivations(agent_public_key);
CREATE INDEX idx_deriv_type ON receipt_derivations(transformation_type);
CREATE INDEX idx_deriv_inputs_hash ON derivation_inputs(input_hash);
CREATE INDEX idx_deriv_inputs_receipt ON derivation_inputs(source_receipt_id);
```

### Query patterns:

**Walk backward (provenanceOf):** "Show me everything that fed into this output."
```sql
-- Recursive CTE to walk the DAG backward
WITH RECURSIVE provenance AS (
  -- Start from the target output
  SELECT d.id, d.output_hash, d.transformation_type, d.confidence_level, 0 as depth
  FROM receipt_derivations d
  WHERE d.output_hash = ?

  UNION ALL

  -- Follow inputs backward
  SELECT d2.id, d2.output_hash, d2.transformation_type, d2.confidence_level, p.depth + 1
  FROM provenance p
  JOIN derivation_inputs di ON di.derivation_id = p.id
  JOIN receipt_derivations d2 ON d2.output_hash = di.input_hash
  WHERE p.depth < 100  -- Safety limit
)
SELECT * FROM provenance ORDER BY depth;
```

**Walk forward (descendantsOf):** "Show me everything derived from this data."
```sql
WITH RECURSIVE descendants AS (
  SELECT d.id, d.output_hash, d.transformation_type, 0 as depth
  FROM derivation_inputs di
  JOIN receipt_derivations d ON d.id = di.derivation_id
  WHERE di.input_hash = ?

  UNION ALL

  SELECT d2.id, d2.output_hash, d2.transformation_type, ds.depth + 1
  FROM descendants ds
  JOIN derivation_inputs di ON di.input_hash = ds.output_hash
  JOIN receipt_derivations d2 ON d2.id = di.derivation_id
  WHERE ds.depth < 100
)
SELECT * FROM descendants ORDER BY depth;
```

### Scaling:

| Chain Depth | Walk Time (SQLite, indexed) | Notes |
|------------|---------------------------|-------|
| 1-10 | <1ms | Typical agent pipeline |
| 10-100 | 1-10ms | Complex orchestrations |
| 100-1000 | 10-100ms | Acceptable for deep chains |
| 1000+ | 100ms+ | Consider SNARK compression (Extension 1) |

SQLite's recursive CTE performance is excellent for DAG traversal with proper indexes. The `depth < 100` limit prevents infinite loops in malformed data.

---

## 4. HTTP Headers for Provenance

### New headers:

```
X-Soma-Derived-From: <comma-separated list of parent data hashes>
X-Soma-Derivation-Type: computed|filtered|aggregated|enriched|transformed|llm_processed|passthrough
X-Soma-Derivation-Cert: <derivation cert ID>
X-Soma-Provenance-Depth: <total chain depth>
X-Soma-Provenance-Confidence: full|partial|origin_only|unverified
X-Soma-Provenance-Gaps: <depth:reason pairs, e.g. "3:no_cert,5:revoked_signer">
```

### Header flow example:

```
Step 1: Agent calls Weather API via ClawNet
  Response headers:
    X-Soma-Data-Hash: abc123
    X-Soma-Signature: <sig>
    X-Soma-Public-Key: <provider_pubkey>
    X-Soma-Provenance-Depth: 0
    X-Soma-Provenance-Confidence: full

Step 2: Agent transforms weather data + stock data
  Agent sends to ClawNet:
    X-Soma-Derived-From: abc123,def456
    X-Soma-Derivation-Type: computed
  ClawNet responds:
    X-Soma-Data-Hash: ghi789
    X-Soma-Derived-From: abc123,def456
    X-Soma-Derivation-Cert: dc-xyz
    X-Soma-Provenance-Depth: 1
    X-Soma-Provenance-Confidence: full

Step 3: Another agent enriches with LLM analysis
  Agent sends:
    X-Soma-Derived-From: ghi789
    X-Soma-Derivation-Type: llm_processed
  ClawNet responds:
    X-Soma-Data-Hash: jkl012
    X-Soma-Derivation-Cert: dc-abc
    X-Soma-Provenance-Depth: 2
    X-Soma-Provenance-Confidence: partial  (LLM step is non-deterministic)
    X-Soma-Provenance-Gaps: 2:llm_processed
```

---

## 5. Detecting Fake/Missing Steps

### The Machine detects problems through five mechanisms:

**1. Missing cert = flagged gap**
If data arrives without any Soma headers, the Machine records the step but marks it `unverified`. The ProvenanceConfidence drops to `origin_only` or `unverified`. Downstream agents see the yellow/red indicator.

**2. Hash mismatch = tampered chain**
If Step 2 claims `Derived-From: abc123` but the output hash of Step 1 is actually `xyz789`, the chain is broken. The Machine rejects the derivation claim and marks it as a gap.

Verification: `derivation_inputs[i].input_hash` must match an actual `output_hash` in `receipt_derivations` or a `dataHash` in a birth cert/cache cert.

**3. Unknown signer = no trust history**
A cert signed by a key with zero verified transactions gets a trust score of 0. The ProvenanceConfidence stays `partial` until the signer accumulates history. Agents see: "Step 3 was signed by an unknown entity."

**4. Temporal anomaly = impossible timeline**
If Step 3's timestamp is BEFORE Step 2's timestamp, the chain is temporally impossible. Flagged as `gap: temporal_anomaly`. The heartbeatIndex provides additional ordering evidence.

**5. Revoked signer = compromised chain**
If any signer in the chain has been revoked (checked via the existing revocation mechanism), everything from that point forward is suspect. ProvenanceConfidence drops to `unverified` for the revoked step and all descendants.

### Progressive disclosure UX:

Following the research finding that every production system uses degraded trust (not binary), the provenance display should use three levels:

```
GREEN (full confidence):
  ✓ Every step has a valid birth cert
  ✓ All signers are known with trust history
  ✓ All hashes chain correctly
  ✓ Timeline is monotonically increasing

YELLOW (partial confidence):
  ⚠ Some steps missing certs (gaps identified)
  ⚠ Some signers are new/unknown (low trust score)
  ⚠ LLM-processed steps (non-deterministic)
  ⚠ But no hash mismatches or temporal anomalies

RED (broken/unverified):
  ✗ Hash mismatch detected (tampered)
  ✗ Temporal anomaly (impossible timeline)
  ✗ Revoked signer in chain
  ✗ No provenance data at all
```

---

## 6. Levels of Proof — What's Actually Provable

Research revealed a clear hierarchy. Honest assessment for Soma:

| Level | What's Proven | How Soma Does It | Trust Assumption | Status |
|-------|--------------|-------------------|------------------|--------|
| 0 | Nothing | Raw API response | Full trust in provider | Default today |
| 1 | **Identity** (who signed) | Birth certificate (Ed25519) | Provider's key management | **Live** |
| 1.5 | **Dual identity** (two parties agree) | Dual-sign (provider + platform) | Both keys | **Live** |
| 2 | **Origin** (where data came from) | zkTLS via Reclaim Protocol | TLS PKI + attestor | **Live (opt-in)** |
| 3 | **Computation** (code C ran) | TEE attestation (AWS Nitro) | Hardware vendor (AWS) | **Not built** |
| 4 | **Computation** (F(X)=Y, math proof) | zkVM (RISC Zero/SP1) | Math only | **Not built** |
| 5 | **Multi-source consensus** | Cross-provider comparison | Majority honest | **Not built** |
| 6 | **Economic guarantee** | Staking + slashing | Stake > fraud profit | **Not built** |
| 7 | **Factual truth** | ??? | ??? | **Nobody has this** |

### Key findings from research:

**TEE (Level 3) is production-ready but imperfect:**
- AWS Nitro: 3-5% compute overhead, proves "code C was loaded in enclave"
- BUT: TEE.Fail (October 2025) extracted ECDSA attestation keys from Intel with $1,000 hardware
- Trail of Bits found parser discrepancies between public tools and private Hypervisor
- Nitro metadata section is completely unattested
- **Practical use:** Good enough for most threat models (protect against co-tenants, employees). Not sufficient against nation-state physical access.

**zkVM (Level 4) is emerging but slow:**
- RISC Zero: Ethereum block proof in 44 seconds (was 35 minutes)
- SP1: 99.7% of L1 blocks proved in <12 seconds (on 16x RTX 5090 cluster)
- Cost: $0.04-0.17 per proof for ~4,000 transactions
- **Practical use:** Batch verification, dispute resolution ("prove correctness only when challenged"). NOT real-time API proxying — seconds of latency is too much.

**TLSNotary/zkTLS (Level 2) has critical limitations:**
- TLS 1.2 only (TLS 1.3 not supported, many modern APIs require it)
- Must be active DURING the TLS session (can't prove after the fact)
- 5-10 seconds overhead per call, tens of MB bandwidth
- Reclaim Protocol (already integrated) uses proxy attestor model — faster but weaker (attestor collusion possible)
- **Practical use:** Selective verification of high-value data sources. Not every call.

**Optimistic proofs (UMA-style) are best for agent economics:**
- Assume correct unless challenged within N hours
- Challenge: re-execute or request proof
- Works when: T is deterministic, X is committed, re-execution is cheap
- Fails when: LLM involved, private data, nobody has incentive to monitor
- **Practical use:** Default for ClawNet. Hash chain assumed valid. Dispute triggers TEE re-exec or ZK proof.

### The honest gap: "Provably signed" ≠ "Provably true"

Cryptography CAN prove: identity, integrity, computation, origin, timing.
Cryptography CANNOT prove: factual correctness, completeness, intent, future behavior.

A provider can sign wrong data with a valid key. The signature is correct. The data is false. No amount of crypto alone fixes this. The only mitigations are:
- Multi-source aggregation (median of N sources)
- Reputation over time (historically accurate providers)
- Economic staking (too expensive to lie)
- Dispute resolution (get caught → get slashed)

**Soma should be transparent about this.** Marketing should say: "Soma proves who produced this data, how it was transformed, and that it hasn't been tampered with. It does NOT guarantee the data is factually correct — that requires trust in the producer's reputation, which Soma helps you measure."

---

## 7. The Blacksmith's Chain — End-to-End Example

```
=== THE BLACKSMITH'S CHAIN ===

STEP 1: ORE MINED (Data Origin)
┌─────────────────────────────────────────────┐
│ Database Provider (runs Soma Heart)          │
│ Produces: weather data for NYC              │
│ Birth cert:                                  │
│   dataHash: "ore_abc123"                    │
│   signature: <provider_ed25519>              │
│   publicKey: <provider_key>                  │
│   heartbeatIndex: 47201                      │
│ Trust: FULL (known provider, 50K history)    │
└─────────────────────────────────────────────┘
        │ (data flows down)
        ▼
STEP 2: ORE REFINED (First Transformation)
┌─────────────────────────────────────────────┐
│ ClawNet Platform (dual-sign)                 │
│ Receives weather data, caches + co-signs    │
│ Cache cert:                                  │
│   originalCert.dataHash: "ore_abc123"       │
│   cacheCert.dataHash: "refined_def456"      │
│   chainHash: SHA256(original + cache)       │
│ Dual-sign:                                   │
│   provider.signature: <original>             │
│   platform.signature: <co-sign>              │
│   providerVerified: true                     │
│ Trust: FULL (both parties verified)          │
└─────────────────────────────────────────────┘
        │
        ▼
STEP 3: HARDENED (Agent Enrichment)
┌─────────────────────────────────────────────┐
│ Agent A (financial analyst, runs Heart)      │
│ Combines: weather + stock data + sentiment  │
│ Derivation cert:                             │
│   outputHash: "hardened_ghi789"             │
│   inputs: [                                  │
│     { hash: "refined_def456", rel: primary },│
│     { hash: "stock_jkl012",  rel: enrichment}│
│     { hash: "sent_mno345",   rel: context }  │
│   ]                                          │
│   transformation: { type: "aggregated" }     │
│   agentPublicKey: <agent_a_key>             │
│   signature: <agent_a_ed25519>              │
│ Trust: PARTIAL                               │
│   (stock_jkl012 has no birth cert - GAP)    │
│   Confidence: { level: 'partial',            │
│     verifiedDepth: 2, totalDepth: 3,        │
│     gaps: [{ depth: 1, reason: 'no_cert' }] │
│   }                                         │
└─────────────────────────────────────────────┘
        │
        ▼
STEP 4: FORGED (LLM Analysis)
┌─────────────────────────────────────────────┐
│ Agent B (portfolio advisor, runs Heart)      │
│ LLM processes combined data into advice     │
│ Derivation cert:                             │
│   outputHash: "forged_pqr678"               │
│   inputs: [                                  │
│     { hash: "hardened_ghi789", rel: primary }│
│   ]                                          │
│   transformation: {                          │
│     type: "llm_processed",                   │
│     description: "GPT-4 portfolio analysis"  │
│   }                                          │
│   agentPublicKey: <agent_b_key>             │
│   signature: <agent_b_ed25519>              │
│ Trust: PARTIAL                               │
│   (LLM step is non-deterministic)           │
│   (inherits stock data gap from Step 3)     │
│   Confidence: { level: 'partial',            │
│     verifiedDepth: 3, totalDepth: 4,        │
│     gaps: [                                  │
│       { depth: 2, reason: 'no_cert' },       │
│       { depth: 0, reason: 'llm_processed' }  │
│     ]                                        │
│   }                                         │
└─────────────────────────────────────────────┘
        │
        ▼
STEP 5: COOLED & STORED (Cached in Machine)
┌─────────────────────────────────────────────┐
│ Verified Cache                               │
│ Stores: forged output + FULL PROVENANCE     │
│ Cache cert binds: Step 4 output → cache     │
│ Soma Check: any agent can probe freshness   │
│ GET /check → returns "forged_pqr678" hash   │
│ Agent C can now decide:                      │
│   - Hash matches my cache? → FREE (skip)    │
│   - Hash different? → Pay cache price       │
│   - Need live? → Pay full price             │
└─────────────────────────────────────────────┘
        │
        ▼
STEP 6: QUALITY VERIFIED (Receipt)
┌─────────────────────────────────────────────┐
│ Every paid interaction → Soma Receipt       │
│ Receipt:                                     │
│   requestHash, responseHash                  │
│   derivation_cert_id: "dc-xyz"              │
│   provenance_depth: 4                        │
│   provenance_confidence: "partial"           │
│   EAS attestation on Base (permanent)        │
│                                              │
│ FULL CHAIN QUERYABLE:                        │
│   Agent C queries: provenanceOf("forged_")  │
│   Gets: Step 4 → Step 3 → Step 2 → Step 1  │
│   Sees: weather origin VERIFIED ✓            │
│         stock data UNVERIFIED ⚠              │
│         LLM step NON-DETERMINISTIC ⚠         │
│         database provider VERIFIED ✓          │
└─────────────────────────────────────────────┘
```

### What the consuming agent sees:

```
Provenance Report for "forged_pqr678":
  Chain depth: 4
  Confidence: PARTIAL (2 gaps)

  ✓ Step 1 (depth 4): Weather data from Provider X
    Trust score: 847 | Verified: YES | Method: Ed25519 birth cert

  ✓ Step 2 (depth 3): Cached + dual-signed by ClawNet
    Provider verified: YES | Platform co-signed: YES

  ⚠ Step 3 (depth 2): Enriched by Agent A (financial analyst)
    Trust score: 312 | Verified: YES (agent cert)
    GAP: stock data input (hash: stock_jkl012) has NO birth cert
    GAP: sentiment input (hash: sent_mno345) has NO birth cert

  ⚠ Step 4 (depth 1): LLM-processed by Agent B (portfolio advisor)
    Trust score: 523 | Verified: YES (agent cert)
    WARNING: Non-deterministic (LLM). Cannot be replayed for verification.

  Decision: Use with caution. 2 of 3 data sources verified.
  Recommendation: Request stock data provider to enable Soma Heart.
```

---

## 8. Integration with Existing Standards

### C2PA compatibility (for media responses):

C2PA uses COSE_Sign1 (CBOR Object Signing) with X.509 certificate chains. Soma uses raw Ed25519 signatures. For media-type API responses (images, video, audio), we can emit a C2PA manifest alongside the Soma birth cert:

- C2PA manifest → standard media provenance (Adobe/Google/Microsoft ecosystem)
- Soma birth cert → agent verification ecosystem
- Same data, two formats, two ecosystems

**Implementation:** When `Content-Type` is image/video/audio, generate a C2PA manifest with:
- `c2pa.actions`: the transformation action (e.g., "c2pa.created" + AI source type)
- Ingredient chain: reference parent manifests for derived media
- COSE signature using Ed25519 (C2PA supports EdDSA on X25519)

**Timeline:** 3-6 months. Not urgent — C2PA tooling for non-media data is nonexistent.

### OpenLineage compatibility (for data pipelines):

OpenLineage uses RunEvent/Job/Dataset as its core model. For agents that operate in data pipeline contexts:

- Emit OpenLineage RunEvents alongside derivation certs
- Map: DerivationCert → RunEvent, inputs → InputDatasets, output → OutputDataset
- Use OpenLineage's facet model for domain-specific metadata

**Implementation:** Optional OpenLineage exporter that converts Soma provenance DAG to OpenLineage event stream.

**Timeline:** 6-12 months. Nice-to-have for enterprise adoption.

---

## 9. Build Order

### Phase 1: Foundation (Buildable NOW)

1. **Add `derived_from` to SomaReceipt schema** — New optional field on receipts
2. **Create `receipt_derivations` + `derivation_inputs` tables** — Migration
3. **`X-Soma-Derived-From` header** — Accept on incoming requests, emit on responses
4. **`createDerivationCert()`** — Core function to create + store derivation certs
5. **Basic `provenanceOf()` query** — Recursive CTE to walk DAG backward
6. **Confidence calculator** — Walk chain, count verified/unverified steps, compute level

### Phase 2: Headers + API (1-2 months)

7. **Full header suite** — Derivation-Type, Provenance-Depth, Provenance-Confidence, Provenance-Gaps
8. **`GET /v1/receipts/:id/provenance`** — Return full provenance DAG for a receipt
9. **`GET /v1/data/:hash/provenance`** — Return provenance by data hash
10. **Dashboard: provenance chain viewer** — Visual DAG in the provider portal

### Phase 3: Intelligence (3-6 months)

11. **Temporal anomaly detection** — Flag impossible timelines
12. **Hash mismatch detection** — Auto-verify derivation claims
13. **Cross-provider comparison** — When multiple providers serve overlapping data
14. **Aggregate confidence scoring** — Trust-weighted chain confidence

### Phase 4: Advanced (6-12 months)

15. **C2PA manifest generation** for media responses
16. **OpenLineage export** for pipeline interop
17. **SNARK compression** for deep chains (Extension 1 from groundbreaking-extensions.md)
18. **TEE-attested derivation** certs for high-value computations

---

## 10. Open Questions for Future Sessions

1. **Should derivation certs be mandatory or opt-in?** Mandatory adds overhead; opt-in means sparse chains. Recommendation: opt-in with strong SDK defaults.

2. **Who pays for provenance tracking?** Additional DB writes + compute. Fold into existing platform fee? Separate provenance tier? Free as competitive differentiator?

3. **Privacy of provenance chains.** If Agent A's provenance reveals which providers they use, competitors could learn their data sources. Need selective disclosure (Session D territory).

4. **LLM steps in the chain.** Non-deterministic steps can't be replayed for verification. Should we treat LLM steps as permanent "soft gaps" in confidence? Or can we do something smarter (TEE-attested LLM execution)?

5. **Cross-platform provenance.** If Agent A uses ClawNet and Agent B uses a different platform, can they still chain provenance? Requires standard format (→ PROV export) and cross-platform cert verification (→ sense-observer as standalone).

6. **Merkle anchoring of provenance DAGs.** Currently receipts get EAS attestations individually. Should we Merkle-anchor the entire provenance DAG periodically? Would provide O(log n) membership proofs for any step in any chain.

---

## Related Docs

- `verified-data-machine.md` — overall Machine vision
- `groundbreaking-extensions.md` — Extension 3 (recursive provenance graphs), Extension 1 (SNARK compression)
- `soma-future-proofing.md` — delegation chain spec (trust delegation, not data derivation)
- `proof-of-delivery-roadmap.md` — TEE + Intent tracks
- `golden-plan.md` — strategic positioning
