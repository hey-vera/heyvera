I’ll verify the current x402 spec and implementations first, then map that against the Cortex/Soma requirements. I’m going to use official spec/reference sources where possible and inspect the repo shape so the Rust guidance fits your actual boundaries.
The repo checkout is on `feat/cortex-billing-ui`, and its `origin` is `https://github.com/hey-vera/heyvera`, not the `claw-net` remote described in the pasted AGENTS text. I’m treating this as the HeyVera/Cortex workspace and will avoid changing code unless you ask; this pass is an architecture/protocol analysis.
I found the current Rust API crates use Axum 0.8, Reqwest, Rusqlite, Ed25519/Soma primitives, and there is already frontend work around Soma spend and subscription billing. The x402 answer should be a foundation-first design: middleware and tables in `crates/api`, receipt linkage through `crates/soma`, no full-node assumption in the first slice.
The current Soma side already has budget caveats, invocation counts, revocation, heartbeat headers, and a spend-log chain, but spend logging is in-memory/file-backed under the Cortex heart. For x402 this means the first production-grade slice should add durable SQLite payment/receipt state, then have Soma attest to it rather than using the existing spend log as the money ledger.
**Bottom line:** for Cortex v1, start with **x402 v2, Base USDC, CDP facilitator, EVM `upto` for variable AI work and `exact` for fixed-price endpoints**. Add Solana later only after the Base path has durable receipts, replay protection, and Soma binding. The x402 spec and Coinbase docs have moved beyond the older `X-PAYMENT` naming: current v2 HTTP headers are `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`.

**1. Protocol Flow**
1. Agent calls `POST /api/chat` or `POST /api/runs` without human subscription auth.
2. Cortex classifies caller:
   - Clerk/subscription user: bypass x402.
   - Agent/API/Soma caller: require x402 unless an internal allowlist applies.
3. Cortex returns `402 Payment Required` with `PAYMENT-REQUIRED: <base64-json>`.
4. Agent decodes `PaymentRequired`, selects an accepted method, signs payment authorization.
5. Agent retries same request with `PAYMENT-SIGNATURE: <base64-json>`.
6. Cortex decodes and validates shape, idempotency key, Soma binding, route, amount ceiling.
7. Cortex calls facilitator `/verify`.
8. If valid, Cortex executes work.
9. If work succeeds, Cortex settles via facilitator `/settle`.
10. Cortex returns `200` with result, `PAYMENT-RESPONSE`, and Soma receipt/provenance headers/body.
11. If work fails before settlement, Cortex does **not settle**. Return failure with no charge.
12. If settlement succeeds but response delivery fails, idempotency lets the agent retry and receive cached result/receipt.

`PAYMENT-REQUIRED` should contain v2:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://cortex.heyvera.org/api/chat",
    "description": "Cortex orchestration request",
    "mimeType": "application/json",
    "serviceName": "Cortex",
    "tags": ["ai", "orchestration", "agents"]
  },
  "accepts": [
    {
      "scheme": "upto",
      "network": "eip155:8453",
      "amount": "25000",
      "asset": "<Base USDC contract>",
      "payTo": "<Cortex treasury wallet>",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    }
  ],
  "extensions": {
    "payment-identifier": {
      "info": { "required": true },
      "schema": { "...": "json schema" }
    },
    "soma": {
      "info": {
        "required": true,
        "audienceDid": "did:key:<cortex>",
        "receiptVersion": "soma-x402/1"
      },
      "schema": { "...": "json schema" }
    }
  }
}
```

For fixed endpoints use `scheme: "exact"` and `amount` as the exact USDC atomic units. For AI generation, `upto` is the right fit because Coinbase documents it specifically for usage-based LLM/token billing and currently says it is EVM-only.

`PAYMENT-SIGNATURE` contains a base64-encoded `PaymentPayload`:

```json
{
  "x402Version": 2,
  "resource": { "url": "https://cortex.heyvera.org/api/chat" },
  "accepted": {
    "scheme": "upto",
    "network": "eip155:8453",
    "amount": "25000",
    "asset": "<Base USDC>",
    "payTo": "<Cortex treasury wallet>",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USDC", "version": "2" }
  },
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0xagent",
      "to": "<Cortex treasury wallet>",
      "value": "25000",
      "validAfter": "...",
      "validBefore": "...",
      "nonce": "0x..."
    }
  },
  "extensions": {
    "payment-identifier": { "info": { "required": true, "id": "pay_..." } },
    "soma": {
      "info": {
        "subjectDid": "did:key:<agent>",
        "delegationId": "dlg_...",
        "requestHash": "sha256:...",
        "paymentIntentHash": "sha256:...",
        "signature": "..."
      }
    }
  }
}
```

Refunds: x402 does not give you a universal native refund primitive for `exact`. The correct design is **verify first, execute second, settle only after successful execution**. If execution fails before settlement, no refund is needed because no transfer happened. If a failure happens after settlement, issue a compensating USDC transfer or account credit, and write a Soma reversal receipt linked to the original x402 settlement.

**2. Chain Selection**
Recommendation: **Base USDC day 1**.

| Chain | Fit | Typical USDC tx fee snapshot | Finality profile | x402 ecosystem |
|---|---:|---:|---|---|
| Base | Best v1 choice | about `$0.06` avg USDC transfer snapshot | ~200ms preconfirm, ~2s L2 block, ~2m L1 batch, ~20m L1 batch finality | strongest: Coinbase/CDP defaults, examples, Base mainnet |
| Arbitrum | Good later | about `$0.08` avg snapshot | fast sequencer UX, Ethereum/fraud-proof security model, 1-week withdrawal challenge | CDP supported |
| Polygon PoS | Good but less x402-default | about `$0.11` avg snapshot | Polygon docs say deterministic finality often 2-5s via milestones | CDP supported |
| Solana | Cheapest raw fees | base fee 5,000 lamports/signature, roughly <$0.01 with current SOL | fast confirmation/finality, but different SVM payment shape | CDP supported, but `upto` not the documented path |

Do **not** support multiple chains day 1. It multiplies wallet funding, receipt reconciliation, failure modes, docs, discovery metadata, and support load. Use:
- `Base Sepolia` for integration tests.
- `Base mainnet eip155:8453` for production.
- `Solana` as slice 2 if agent demand specifically wants SVM wallets.
- `Arbitrum/Polygon` as “accepts” additions only after durable idempotency and accounting are proven.

**3. Discovery**
Use three layers:

1. **x402 Bazaar/CDP discovery** as public agent discovery. Coinbase docs expose discovery endpoints and the x402 spec has a `bazaar` extension for resource metadata.
2. **`/.well-known/x402`** as Cortex-owned deterministic discovery. Not the core spec’s main mechanism, but useful and low-risk.
3. **Soma service directory** as trust/identity overlay, not the only discovery path.

Avoid DNS TXT and on-chain registry for v1. DNS TXT is too cramped and weakly structured. On-chain registry is premature unless discovery itself needs censorship resistance.

**4. Soma Integration**
Soma should bind identity and authorization around x402, not replace x402.

Use Soma delegation caveats for:
- `audience`: Cortex DID.
- `capabilities`: `cortex:chat`, `cortex:runs:create`, `cortex:tools:*`.
- `budget`: max USD/USDC atomic units over delegation lifetime.
- `max-invocations`.
- `expires-at`.
- optional `host-allowlist`.

Cryptographic binding:
- Compute `request_hash = sha256(method + url + canonical_body + selected_route_price_version)`.
- Compute `payment_intent_hash = sha256(PaymentRequired.accepts[selected] + payment_identifier + request_hash)`.
- Agent signs Soma extension payload with `did:key` subject key.
- x402 wallet signs payment authorization.
- Cortex stores both signer identities:
  - `soma_subject_did`
  - `wallet_payer`
  - `delegation_id`
  - `payment_nonce`
  - `payment_identifier`

Receipt chain:
- Existing [crates/soma/src/spend.rs](/home/runner/workspace/crates/soma/src/spend.rs) is useful conceptually, but x402 money state should be durable SQLite first.
- Add an x402/Soma receipt that links:
  - request hash
  - response hash
  - x402 payment payload hash
  - settlement tx hash
  - amount authorized
  - amount settled
  - payer wallet
  - Soma DID/delegation
  - Cortex heartbeat head

**5. Rust Implementation**
There is no official Rust SDK in the x402 Foundation repo; official/reference SDKs are TypeScript, Python, and Go. There is an independent `x402-rs` ecosystem with `x402-axum`, `x402-types`, `x402-chain-eip155`, `x402-chain-solana`, and `x402-reqwest`, but I would treat it as a dependency to audit, not as protocol truth.

For Cortex’s current Axum layout, add:

```text
crates/api/src/x402/
  mod.rs
  types.rs          // PaymentRequired, PaymentPayload, SettleResponse
  config.rs         // network, asset, pay_to, facilitator URL
  pricing.rs        // route -> exact/upto amount
  facilitator.rs    // reqwest client for /verify and /settle
  middleware.rs     // Axum/Tower layer
  idempotency.rs    // payment-identifier handling
  soma_binding.rs   // delegation + DID binding checks
  receipt.rs        // durable receipt creation
```

Add SQLite tables in [crates/api/src/db.rs](/home/runner/workspace/crates/api/src/db.rs):

```sql
x402_payments(
  id TEXT PRIMARY KEY,
  payment_identifier TEXT UNIQUE NOT NULL,
  request_hash TEXT NOT NULL,
  payment_payload_hash TEXT NOT NULL,
  payer TEXT,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount_authorized TEXT NOT NULL,
  amount_settled TEXT,
  status TEXT NOT NULL,
  tx_hash TEXT,
  soma_subject_did TEXT,
  soma_delegation_id TEXT,
  response_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
)
```

Middleware pattern:
- Run after auth classification but before expensive handlers.
- If Clerk subscription active, skip.
- If no `PAYMENT-SIGNATURE`, return 402.
- If payment present, verify, attach `X402Context` to request extensions.
- Handler computes actual usage.
- Response finalizer settles and writes receipt.

Do not verify USDC locally in v1. Use CDP facilitator so Cortex does not need full nodes, mempool monitoring, token ABI drift, Permit2 handling, or compliance screening. Local verification can come later with `alloy` for EVM EIP-712/EIP-3009 and `solana-sdk` for SVM.

**6. Edge Cases**
- Replay: require `payment-identifier`, enforce unique `(payment_identifier, request_hash, payload_hash)`, reject same id with different payload.
- Double-spend: rely on EIP-3009 nonce/authorization and facilitator settlement, but also mark payment ids `settling` before `/settle`.
- Underpayment: compare `accepted.amount`, `authorization.value`, asset, network, and `payTo`; reject exact mismatches.
- Overpayment: for `exact`, reject mismatched amount. For `upto`, settle actual amount and receipt both authorized and settled.
- Front-running: EIP-3009/Permit2 binds recipient and amount; attacker cannot redirect funds, but can grief by submitting authorization first. Idempotency and payer/request binding limit value extraction.
- DDoS via 402: rate-limit unauthenticated 402 challenges by IP/user-agent, keep 402 bodies tiny, precompute route requirements, and do not call facilitator until a payment header is present.
- Facilitator outage: fail closed for paid agent calls, but keep subscription users unaffected.
- Response lost after settlement: cache response by payment id and return same `PAYMENT-RESPONSE` and Soma receipt on retry.
- Privacy: do not leak full prompt/body to facilitator. Send only standard payment requirements; keep Soma/request hashes in Cortex unless needed by extension.

**7. Existing Implementations**
- x402 Foundation repo: canonical spec and TypeScript/Python/Go SDKs.
- Coinbase CDP x402: production facilitator and docs; supports Base, Polygon, Arbitrum, World, Solana.
- x402-rs: independent Rust implementation with Axum middleware and EVM/Solana support; promising, but audit before adopting.
- Cloudflare Agents x402 docs: useful signal that agent/server x402 adoption is growing.

Sources used:
- x402 Foundation spec/repo: https://github.com/x402-foundation/x402
- x402 v2 HTTP/spec files from the repo: https://github.com/x402-foundation/x402/tree/main/specs
- Coinbase x402 flow/docs: https://docs.cdp.coinbase.com/x402/core-concepts/how-it-works
- Coinbase seller/facilitator docs: https://docs.cdp.coinbase.com/x402/quickstart-for-sellers and https://docs.cdp.coinbase.com/x402/core-concepts/facilitator
- Base finality docs: https://docs.base.org/base-chain/network-information/transaction-finality
- Polygon finality docs: https://docs.polygon.technology/pos/concepts/finality/finality
- Solana fees docs: https://solana.com/docs/core/fees/fee-structure
- x402-rs: https://github.com/x402-rs/x402-rs
- USDC fee snapshot: https://www.scanusdc.com/en/cost/usdc-gas-fee-calculator-real-time
