# Soma Data Custody Protocol

Soma primitive for cryptographic proof of honest data handling.
Any agent with a Heart can use this to prove:
- When it accepted custody of user data
- Every time it accessed that data (tamper-evident)
- That it destroyed the encryption key on deletion (crypto-shredding)

## Architecture

```
Agent accepts custody of user data
  → Generates per-user DEK (Data Encryption Key)
  → Encrypts all user data with DEK
  → Commits DEK fingerprint H(DEK) to pulse tree via CUSTODY_ACCEPT leaf
  → ClawNet never sees the DEK or plaintext — only the fingerprint

Agent accesses data (e.g., scheduled task)
  → Decrypts data with DEK
  → Performs operation
  → Re-encrypts
  → Commits CUSTODY_ACCESS leaf with reason + fields accessed

User deletes account
  → Agent destroys DEK (secure wipe)
  → Generates destruction proof: H(dekFingerprint || 'destroyed' || timestamp)
  → Commits CUSTODY_RELEASE leaf with destruction proof
  → Even backups are irrecoverable — ciphertext without key is noise
```

## Pulse Tree Leaf Type

```typescript
CUSTODY = 0x08  // in PULSE_TYPE enum (pulse-tree.ts)
```

Payload variants:

| Event | Payload Fields |
|-------|---------------|
| `accept` | subjectId (hashed), dekFingerprint |
| `access` | subjectId (hashed), fieldsAccessed, reason |
| `release` | subjectId (hashed), dekFingerprint, destructionProof |

## API Endpoints

All at `/v1/soma/custody/` — require API key auth.

### POST /accept
Agent commits to custodying a subject's data.

```json
{
  "subjectId": "tenant-123",
  "dekFingerprint": "a1b2c3d4e5f6...",
  "fieldsManifest": ["brand-profile", "knowledge", "crm"]
}
```

Returns: custodyId, heartbeatIndex, pulseRoot.

Rejects if active custody already exists for this subject (must release first).

### POST /access
Log a data access event.

```json
{
  "subjectId": "tenant-123",
  "reason": "scheduled-post",
  "fieldsAccessed": ["brand-profile"]
}
```

Returns: eventId, heartbeatIndex.

### POST /release
Crypto-shred: destroy DEK and publish proof.

```json
{
  "subjectId": "tenant-123",
  "destructionProof": "h(fingerprint||destroyed||timestamp)"
}
```

Returns: heartbeatIndex, pulseRoot, totalAccesses, custodyDurationHours.

Rejects if no active custody or already released.

### GET /:did/:subjectId
Get the full verifiable custody chain for an agent-subject pair.

Returns: status (active/released/none), dekFingerprint, acceptedAt, releasedAt,
totalAccesses, lastAccessAt, destructionProof, full event chain.

## DB Schema (Migration v190)

```sql
CREATE TABLE custody_events (
  id TEXT PRIMARY KEY,
  agent_did TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('accept', 'access', 'release')),
  dek_fingerprint TEXT,
  destruction_proof TEXT,
  fields_manifest_json TEXT,
  fields_accessed_json TEXT,
  access_reason TEXT,
  pulse_leaf_index INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_custody_agent_subject ON custody_events(agent_did, subject_id);
CREATE INDEX idx_custody_agent_type ON custody_events(agent_did, event_type);
```

## Trust Integration

`getCustodySummary(agentDid)` returns:
- activeCount: how many subjects' data is currently in custody
- releasedCount: how many have been cleanly released
- totalAccesses: lifetime data access count
- avgAccessesPerCustody: average accesses per subject

Agents with clean custody records (many releases, no violations) get trust boosts.
Agents that access data without logging get flagged by observers (Soma sense).

## What This Proves

| Claim | How |
|-------|-----|
| Agent deleted my data | DEK destroyed, destruction proof in pulse tree, anchored on-chain via Groth16 |
| Agent didn't alter history | Changing any leaf breaks the Merkle root already on-chain |
| Agent only accessed data for my tasks | Every access logged as tamper-evident leaf with reason |
| Agent can't read my sensitive fields | Sensitive fields encrypted with session-scoped keys (not stored) |

## Privacy

- Subject IDs are hashed (somaHash) before entering the pulse tree
- DEK fingerprints are hashes of keys, not keys themselves
- Destruction proofs prove key destruction without revealing the key
- ClawNet never sees plaintext data or actual encryption keys

## GDPR Compatibility

Crypto-shredding is GDPR-accepted (Article 29 Working Party endorsed it):
- Delete the key = delete the data (even if ciphertext persists in backups)
- The destruction proof is the auditable record of erasure
- Historical custody chain preserved for audit (just hashes, no personal data)

## Implementation Files

| File | Purpose |
|------|---------|
| `src/core/soma-custody.ts` | Core protocol: accept, access, release, query, summary |
| `src/core/soma-heartbeat.ts` | `appendCustody()` — typed append for CUSTODY leaves |
| `src/core/pulse-tree.ts` | `CUSTODY = 0x08` leaf type |
| `src/routes/custody.ts` | API endpoints with Zod validation |
| `src/db/connection.ts` | Migration v190: custody_events table |

## Usage Example (Pulse)

```typescript
// On customer signup — accept custody
await clawnet.post('/v1/soma/custody/accept', {
  subjectId: tenantId,
  dekFingerprint: crypto.createHash('sha256').update(dek).digest('hex'),
  fieldsManifest: ['brand-profile', 'knowledge', 'crm', 'engagement-data']
});

// On every scheduler tick — log access
await clawnet.post('/v1/soma/custody/access', {
  subjectId: tenantId,
  reason: 'scheduled-post',
  fieldsAccessed: ['brand-profile']
});

// On customer deletion — crypto-shred
secureWipeDek(dek); // destroy the key
await clawnet.post('/v1/soma/custody/release', {
  subjectId: tenantId,
  destructionProof: crypto.createHash('sha256')
    .update(`${dekFingerprint}:destroyed:${Date.now()}`)
    .digest('hex')
});
```
