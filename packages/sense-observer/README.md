# @clawnet/sense-observer

External verifier for Soma birth certificates — the **Sense** side of Soma's heart/sense separation.

> **Never self-verify.** Hearts SIGN data. Senses VERIFY signatures. A sense MUST run in a different process/machine/org than the heart it's verifying, or its verdict is meaningless.

## Install

```bash
npm install @clawnet/sense-observer
```

## Library usage

```typescript
import { verifyBirthCert } from '@clawnet/sense-observer';

const result = verifyBirthCert({
  cert,              // the BirthCertificate returned from a Soma heart
  data: rawJson,     // the raw data the cert claims to seal (optional)
  publicKey: heartPubKey,  // hex or base64
  maxAgeSeconds: 3600,     // reject certs older than 1h (optional)
});

if (!result.valid) {
  console.error('Verification failed:', result.reasons);
} else {
  console.log('Valid', result.checks);
}
```

### Dual-signed certificates

```typescript
const result = verifyBirthCert({
  cert,
  publicKey: receiverHeartPubKey,
  sourcePublicKey: sourceHeartPubKey,  // required for dual-signed
});
```

### Chain verification

```typescript
import { verifyBirthCertChain } from '@clawnet/sense-observer';

const keys = new Map([
  ['did:soma:heart1', pubKey1],
  ['did:soma:heart2', pubKey2],
]);

const result = verifyBirthCertChain(chain, keys);
if (!result.valid) {
  console.error(`Broken at index ${result.brokenAt}: ${result.reason}`);
}
```

## CLI usage

```bash
# Verify a single certificate
sense verify ./cert.json --pubkey abc123...ef --data ./data.json

# Verify a dual-signed cert
sense verify ./cert.json \
  --pubkey <receiver-key> \
  --source-pubkey <source-key> \
  --data ./data.json

# Verify a chain
sense verify-chain ./chain.json --keys ./heart-keys.json

# JSON output for scripting
sense verify ./cert.json --pubkey <key> --json
```

Exit codes: `0` valid · `1` invalid · `2` usage error.

## What this verifies

A Soma birth certificate seals data at its genesis: who signed it, when, through what heart, and a hash of the original content.

This package performs the following checks:

| Check | What it proves |
|---|---|
| Shape | Cert has all required fields |
| Not future-dated | `bornAt` is in the past |
| Age (optional) | Cert is within `maxAgeSeconds` |
| Data integrity | `sha256(data)` matches `cert.dataHash` |
| Receiver signature | Cert was signed by the claimed heart |
| Source signature | (Dual-signed only) Source heart co-signs |

## What this does NOT verify

Soma Sense is **experimental** as a trust control. It tells you:

- **Who signed the data** (cryptographic origin)
- **That the data wasn't modified** (integrity)

It does **not** tell you:

- **That the data is factually correct** (origin ≠ truth)
- **That the heart isn't compromised** (signature is only as trustworthy as the key)
- **That temporal claims hold** (timestamps are self-reported)

Use Sense as **one** trust signal, not the only one.

## Design

This package is deliberately minimal:

- Zero runtime dependencies except `tweetnacl`
- < 200 LOC of verification logic
- No network calls — you supply the keys
- No config files — everything via API/CLI args

The design reflects Soma's "never self-verify" principle: **you** decide which hearts to trust, **you** supply their public keys, **you** make the policy call on age/tier/signature requirements.

## License

MIT
