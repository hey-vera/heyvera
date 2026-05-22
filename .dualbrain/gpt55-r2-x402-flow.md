I’ll verify the live x402/CDP and USDC authorization details first, then synthesize a protocol-level design with concrete receipt fields and failure handling.
Below is the protocol-engineering answer I would build from.

**1. CDP Facilitator**
CDP’s hosted facilitator base URL is:

```text
https://api.cdp.coinbase.com/platform/v2/x402
```

Documented endpoints:

```text
GET  /v2/x402/supported
POST /v2/x402/verify
POST /v2/x402/settle
GET  /v2/x402/discovery/resources
GET  /v2/x402/discovery/search
GET  /v2/x402/discovery/merchant?payTo=<address>
POST /v2/x402/discovery/mcp
```

Production facilitator auth requires CDP API bearer JWTs for `/supported`, `/verify`, and `/settle`; discovery routes are public read APIs. CDP supports x402 v1/v2 on Base, Base Sepolia, Polygon, Arbitrum, World, World Sepolia, Solana, and Solana Devnet, with `exact` and `upto` on EVM and `exact` on Solana. Pricing is published as 1,000 facilitator transactions free per month, then `$0.001/transaction`; onchain gas is separate. CDP rate limits are 500 write requests / 10 seconds and 600 read requests / 10 seconds. CDP idempotency uses `X-Idempotency-Key`, UUIDv4, with 24-hour replay of the original response for the same request.

SLA: I found a public status page, but no public x402-specific SLA in the docs I checked. Treat CDP as production-grade but do not encode an SLA assumption into HeyVera unless you have a contract.

Self-hosting: x402 is permissionless. A facilitator only verifies signatures and submits signed payments; it does not need custody if implemented correctly. Official/community SDKs exist for TypeScript, Go, and Python. For production, self-hosting means you own RPC reliability, gas funding, KYT/OFAC screening, nonce replay cache, settlement retry logic, and regulatory exposure.

Other facilitators: `https://x402.org/facilitator` exists for testnet only and does not require API keys. CDP docs point to the x402 ecosystem for third-party/community facilitators, but CDP is the only clearly documented production facilitator in the sources I verified.

Sources: CDP network support, facilitator API, pricing/rate/idempotency docs, x402 spec.  
https://docs.cdp.coinbase.com/x402/network-support  
https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/x402-facilitator  
https://docs.cdp.coinbase.com/api-reference/v2/rate-limits  
https://docs.cdp.coinbase.com/api-reference/v2/idempotency  
https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md

**2. Agent Wallets**
Best day-1 choice: **CDP Server Wallet v2 EOA for payer agents on Base USDC**, with Soma delegations enforcing offchain policy.

Reason:

- x402 `exact` on EVM uses EIP-3009 `transferWithAuthorization`, which is naturally EOA/ECDSA/EIP-712 friendly.
- USDC EIP-3009 requires no prior approval and no native gas for the agent; facilitator submits the transfer.
- CDP Server Wallet v2 keeps keys in a TEE and supports programmatic signing.
- CDP Agentic Wallet already wraps wallets, onramp, and x402 payments with per-call/per-session spend controls.

Use ERC-4337 smart accounts when the agent needs batching, explicit onchain spend permissions, paymaster flows, or richer recovery/policy semantics. Do not make ERC-4337 the first x402 payer primitive unless the specific x402 implementation supports the smart account signature path you need. EIP-3009 was written around normal signatures; smart contract wallets need ERC-1271-style validation or a proxy path, which is extra surface area.

Recommended HeyVera wallet model:

```text
Human owner
  -> creates/funds agent wallet
  -> issues Soma delegation:
       did agent, wallet address, max_per_call, max_session, allowed_resource_hashes,
       allowed_networks, expires_at, revocation_id
Agent
  -> signs x402 payment payload from wallet
  -> signs Soma request envelope from did:key
Cortex/HeyVera policy engine
  -> verifies Soma delegation before wallet signing
```

Funding path:

- Human signs in with Clerk/Coinbase/embedded wallet.
- Create CDP EOA or import external EOA.
- Fund with Base USDC through Coinbase Onramp, Coinbase transfer, or user deposit.
- Agent receives only scoped signing capability through policy, never raw key material.

Sources:  
https://docs.cdp.coinbase.com/server-wallets/v2/introduction/welcome  
https://docs.cdp.coinbase.com/server-wallets/v2/introduction/accounts  
https://docs.cdp.coinbase.com/agentic-wallet/welcome  
https://docs.cdp.coinbase.com/agentic-wallet/mcp/welcome  
https://eips.ethereum.org/EIPS/eip-3009

**3. Settlement Atomicity**
x402 is not truly atomic across service execution, payment settlement, and HTTP response delivery. It is “verify, execute, settle, respond.” So design for recoverability.

For `exact` EIP-3009:

```text
authorization = {
  from: address,
  to: address,
  value: uint256 decimal string,
  validAfter: unix seconds string,
  validBefore: unix seconds string,
  nonce: bytes32 hex
}
signature = EIP-712 signature over TransferWithAuthorization
```

EIP-3009 requires:

- random 32-byte nonce,
- authorization unused,
- `now > validAfter`,
- `now < validBefore`,
- valid EIP-712 domain with token contract and chain ID,
- transfer amount and recipient bound by signature.

If execution may take 30s, do not accept a payment with only 30s left. Gate before work:

```text
required_settlement_slack = p99_facilitator_settle_seconds + chain_finality_slack + retry_slack
minimum_validity_remaining = max_expected_execution_seconds + required_settlement_slack
```

For Base USDC, I would start conservative:

```text
maxTimeoutSeconds: 120 for normal API calls
validBefore >= now + 120
abort_before_work if validBefore - now < 90
```

For long jobs:

- Do not use one `exact` payment across the whole job unless you settle before execution.
- Use prepaid/session balance, batch settlement, or explicit job escrow.
- Or split into phases: authorize and settle job-start fee, execute, then authorize result/retrieval fee.

If facilitator settles but HTTP response is lost:

- Treat EIP-3009 `nonce` as the onchain payment identity.
- Also include an application `payment_identifier` UUIDv7/UUIDv4 in the Soma/x402 binding.
- Send `X-Idempotency-Key` to CDP `/settle`.
- Store receipt before responding.
- On client retry with same `payment_identifier`, return the stored result/receipt; never call `/settle` again unless local state is missing and CDP idempotency/onchain lookup confirms the prior result.

**4. Multi-Call Sessions**
Do not use one `upto` authorization for a 10-message chat session if you intend to settle per message. The x402 `upto` spec is single-use: verify with max amount, settle once for actual amount. It explicitly excludes streaming and multi-settlement.

Good options:

1. **Per-message `exact`**
   Best for v1. Simple, auditable, but 10 messages means 10 settlements.

2. **Per-message `upto`**
   Good when each message has variable token cost. Each message gets a fresh single-use authorization.

3. **Prepaid balance**
   Best UX for agent chat. User/agent deposits Base USDC into a HeyVera balance or escrow. Each message decrements internal ledger and emits Soma receipts. Settle onchain only when topping up or withdrawing. This may increase regulatory/custody complexity.

4. **Batch settlement / vouchers**
   Best long-term protocol path. Client locks capital or opens a channel, then signs per-message vouchers. Provider redeems later. x402 has a `batch-settlement` scheme concept covering escrow, payment channels, delegated authorization, and credit-backed settlement.

Recommendation:

```text
v1 public API: per-call exact
v1 variable-cost inference: per-call upto
v1 agent chat product: Stripe/subscription for humans, per-message exact/upto for external agents
v2 high-volume agents: Soma SessionEscrow + x402 batch-settlement binding
```

Sources:  
https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md  
https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto_evm.md  
https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md

**5. Exact Soma-x402 Receipt**
Use canonical DAG-CBOR for the receipt body. CID = CIDv1 with `dag-cbor` codec and `sha2-256` multihash. Use Keccak-256 only for EVM/EIP-712 digest fields. Use Ed25519 for Soma DID signatures.

```ts
type SomaX402ReceiptV1 = {
  type: "heyvera.soma.x402.receipt";
  version: 1;

  receipt_id: string;              // CID of canonical receipt without signatures
  issued_at: string;               // RFC3339 UTC
  environment: "prod" | "test";
  service: {
    service_did: string;           // did:key or service DID
    service_origin: string;        // https origin
    resource_url: string;
    resource_hash: string;         // CID/sha2-256 of normalized route + params/body hash
  };

  actor: {
    payer_did: string;             // Soma DID, optional if pure wallet caller
    agent_did?: string;
    wallet_network: string;        // CAIP-2, e.g. eip155:8453
    wallet_address: string;
    delegation_cid?: string;       // Soma delegation object
    delegation_chain_cids: string[];
  };

  request: {
    method: string;
    url: string;
    headers_hash: string;          // sha2-256 over canonical allowlisted headers
    body_hash: string;             // sha2-256 over raw body bytes, or null-body hash
    request_hash: string;          // sha2-256 over canonical request envelope
    idempotency_key: string;       // UUID sent to CDP settle, if used
    payment_identifier: string;    // HeyVera stable UUID
  };

  x402: {
    x402_version: 2;
    scheme: "exact" | "upto" | "batch-settlement";
    facilitator_url: string;
    payment_requirements_hash: string; // sha2-256 DAG-CBOR PaymentRequirements
    payment_payload_hash: string;      // sha2-256 DAG-CBOR PaymentPayload
    payment_required?: unknown;        // optional embedded normalized object
    payment_payload?: unknown;         // optional, redactable if storing separately
  };

  payment: {
    asset: string;                  // USDC contract address
    asset_decimals: number;         // 6 for USDC
    amount_authorized: string;      // atomic units
    amount_settled: string;         // atomic units
    pay_to: string;
    payer: string;
    eip712_digest?: string;         // keccak256 digest
    eip3009?: {
      from: string;
      to: string;
      value: string;
      valid_after: string;
      valid_before: string;
      nonce: string;
      signature: string;
    };
    settlement: {
      success: boolean;
      network: string;
      transaction_hash: string;
      block_number?: string;
      facilitator_response_hash: string;
      settled_at?: string;
    };
  };

  work: {
    execution_id: string;
    worker_did?: string;
    model_or_tool?: string;
    input_commitment: string;       // hash/CID of request payload or observation envelope
    output_commitment: string;      // hash/CID of response body or redacted output
    metering: {
      unit: "request" | "tokens" | "bytes" | "seconds" | "custom";
      quantity: string;
      rate_atomic?: string;
    };
    status: "fulfilled" | "failed_after_payment" | "failed_before_settlement";
    completed_at: string;
  };

  trust: {
    soma_request_signature: string; // Ed25519 over request_hash
    service_signature: string;      // Ed25519 over receipt body hash
    facilitator_signer?: string;    // from /supported if response extension/signature exists
  };

  privacy: {
    pii_policy: "none" | "redacted" | "encrypted";
    redaction_hash?: string;
  };
};
```

Verification steps:

```text
1. Decode DAG-CBOR receipt and recompute receipt_id.
2. Verify service DID signature over receipt body hash.
3. Verify payer/agent Soma DID signature over request_hash.
4. Verify Soma delegation chain:
   - issuer signatures,
   - caveats,
   - action scope,
   - resource hash,
   - max spend,
   - time window,
   - revocation status.
5. Recompute request_hash from method/url/body/allowlisted headers.
6. Recompute payment_requirements_hash and payment_payload_hash.
7. Verify x402 payload:
   - EIP-712 domain: USDC name/version, chain ID, token contract.
   - EIP-3009 signature recovers payment.payer.
   - authorization.to == pay_to.
   - authorization.value == amount_authorized.
   - validAfter/validBefore bounds.
   - nonce matches receipt.
8. Verify settlement:
   - transaction exists on declared chain,
   - calls USDC `transferWithAuthorization`,
   - `AuthorizationUsed(payer, nonce)` exists,
   - transfer amount/payee match receipt,
   - transaction hash matches facilitator response.
9. Verify work:
   - output body hash/CID matches returned response,
   - metering explains amount_settled,
   - status is consistent with payment timing.
```

**6. Regulatory**
Short version: Cortex is lower risk if it only sells its own compute/API service and receives direct wallet-to-wallet USDC payments for that service. It becomes higher risk if it holds customer funds, pools prepaid balances, converts fiat/crypto, pays third parties on behalf of users, or operates a hosted wallet/facilitator as a business.

FinCEN’s old but still central CVC guidance says a user who obtains convertible virtual currency and uses it to buy goods/services is not an MSB; administrators/exchangers that accept and transmit CVC can be money transmitters unless an exemption applies. FinCEN has also recognized a merchant payment processor exemption in some fiat payment-processing contexts, but virtual currency payment processors have historically been treated carefully and often do not fit cleanly if they accept/transmit value.

Using CDP helps because Coinbase provides KYT/OFAC screening and operates inside its own compliance stack, but it does not automatically make HeyVera non-regulated. The key legal question is still: who controls customer value, who transmits it, and whose goods/services are being purchased?

Practical v1 posture:

```text
- Do not custody external agent balances unless counsel signs off.
- Prefer direct x402 payments from payer wallet to HeyVera merchant wallet.
- Use CDP facilitator for KYT/OFAC and gas abstraction.
- Keep HeyVera as merchant/resource server, not money router.
- If prepaid balances are needed, start with Stripe/subscription ledger for humans.
- For USDC prepaid escrow, get counsel before launch.
- If self-hosting facilitator, keep it non-custodial and only for HeyVera-owned services at first.
```

Sources:  
https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering  
https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/definition-money-transmitter-merchant-payment  
https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/request-administrative-ruling-application  
https://docs.cdp.coinbase.com/x402/core-concepts/facilitator  
https://www.coinbase.com/developer-platform/products/x402/
