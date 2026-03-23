# @aidprotocol/middleware

AID trust verification middleware for **Express**, **Fastify**, and any Node.js HTTP server.

Verifies Ed25519 signatures, resolves trust scores via the AID Protocol, and enforces trust gates — all in one line.

## Install

```bash
npm install @aidprotocol/middleware
```

## Express

```typescript
import express from 'express';
import { aidTrust } from '@aidprotocol/middleware/express';

const app = express();
app.use(express.json());
app.use(aidTrust({ minTrustScore: 40 }));

app.get('/data', (req, res) => {
  if (req.aidInfo) {
    console.log(req.aidInfo.did);        // did:key:z6Mk...
    console.log(req.aidInfo.trustScore); // 87
    console.log(req.aidInfo.verdict);    // 'trusted'
    console.log(req.aidInfo.discount);   // 0.25
  }
  res.json({ ok: true });
});

app.listen(3000);
```

## Fastify

```typescript
import Fastify from 'fastify';
import { aidTrustPlugin } from '@aidprotocol/middleware/fastify';

const app = Fastify();
app.register(aidTrustPlugin, { minTrustScore: 40 });

app.get('/data', (req, reply) => {
  if (req.aidInfo) {
    console.log(req.aidInfo.trustScore); // 87
  }
  reply.send({ ok: true });
});

app.listen({ port: 3000 });
```

## Framework-Agnostic (Core)

Use the core `verifyAidRequest()` function with any HTTP framework:

```typescript
import { verifyAidRequest } from '@aidprotocol/middleware';

// In your HTTP handler:
const result = await verifyAidRequest(
  (name) => req.headers[name.toLowerCase()], // header getter
  req.method,                                 // HTTP method
  req.url,                                    // URL path
  Buffer.from(body),                          // raw body
  { minTrustScore: 40 },                      // config
);

if (result.ok) {
  console.log(result.aidInfo.trustScore); // 87
} else if (result.code !== 'AID_NOT_PRESENT') {
  res.status(result.status).json({ error: result.error, code: result.code });
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `minTrustScore` | `0` | Minimum trust score required (0-100) |
| `apiUrl` | `https://api.claw-net.org` | AID trust resolution API |
| `failMode` | `'closed'` | `'closed'` rejects when API unreachable; `'open'` allows at score 0 |
| `cacheTtlSeconds` | `300` | Trust score cache TTL |
| `timestampToleranceSeconds` | `300` | Signature timestamp tolerance (±seconds) |
| `onVerified` | — | Callback on successful verification |
| `onRejected` | — | Callback when trust gate blocks a request |

## What Gets Verified

1. **Ed25519 signature** — proves DID ownership (self-certifying, no registry lookup)
2. **Timestamp** — within ±5 minute window (configurable)
3. **Nonce** — anti-replay (tracked in-memory, 5-minute TTL)
4. **Trust score** — resolved from AID trust API, cached locally
5. **Trust gate** — rejects callers below `minTrustScore`

## AID Headers

Callers send these headers:

| Header | Description |
|--------|-------------|
| `X-AID-DID` | Agent's DID (`did:key:z...`) |
| `X-AID-PROOF` | Ed25519 signature (base64url) |
| `X-AID-TIMESTAMP` | ISO 8601 UTC timestamp |
| `X-AID-NONCE` | 16 random bytes (32 hex chars) |

## `req.aidInfo`

When AID headers are present and valid:

```typescript
{
  did: 'did:key:z6Mk...',
  trustScore: 87,
  verdict: 'trusted',       // new|building|caution|standard|trusted|proceed
  discount: 0.25,           // trust-gated pricing discount
  settlementMode: 'batched', // immediate|standard|batched|deferred
  signatureVerified: true,
  cached: false,
}
```

When AID headers are absent, `req.aidInfo` is `undefined` (AID is optional).

## Security

- Middleware **never handles private keys** — it only verifies signatures using public keys extracted from the DID
- Fail-closed by default — rejects requests if trust API is unreachable
- Nonce tracking prevents replay attacks
- Ed25519 signatures are verified using Node.js built-in `crypto` module (no external deps)

## License

MIT — [AID Protocol](https://aidprotocol.org)
