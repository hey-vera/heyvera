# Soma Wallet Rotation Architecture

Status: **backlog / design** — not yet built. Hard constraint: Soma is open source, so the design must be 10/10 unexploitable with all code public.
Opened: 2026-04-10
Related: `trust-accountability-teeth.md`, `soma-1-2-scope.md`, `secret-scanner.md`, Soma `src/heart/`

## Problem

ClawNet (and every heart operator) holds a long-lived EVM private key for x402 settlement and on-chain anchoring. Today that key sits in a `.env` file on a VPS. The blast radius of a single leak is catastrophic: drained wallet, forged attestations, poisoned receipt chain. The session that produced this doc leaked a ClawNet API key via an unrelated file diff — proof that static long-lived secrets in plaintext are a matter of *when*, not *if*.

The goal: build wallet rotation **into soma-heart itself** so that every heart deployment — ClawNet, Nova, HeyDATA, third parties — gets automatic, auditable, panic-capable key rotation as a first-class primitive. No operator should ever have to hand-rotate a key under pressure.

Because Soma is open source, we cannot rely on secrecy of the rotation mechanism. The design must be **secure against an attacker who has read every line of code.**

## Threat model

- Attacker reads the entire Soma source tree.
- Attacker steals a single session key from a live host (memory scrape, log leak, compromised dep).
- Attacker steals the `.env` file but not the TEE/HSM/threshold shards.
- Attacker front-runs a rotation event on a public mempool.
- Attacker MITM's the oracle channel used to announce rotations.
- Attacker compromises one of N threshold shard holders.
- Attacker bribes the verifier in a buyer-paid verification flow (cross-reference `soma-1-2-scope.md`).

Out of scope: attacker compromises the Secure Enclave / HSM directly. We assume platform key storage works.

## Two-tier key hierarchy

```
Tier 0 — Bootstrap key (cold, threshold, never touches hot path)
    │
    ├── signs rotation events
    ├── signs emergency freeze
    └── derivation path anchor for session keys

Tier 1 — Session keys (hot, short-lived, policy-scoped)
    │
    ├── sign outbound x402 settlements
    ├── sign heartbeat anchors
    └── sign receipt attestations
```

**Tier 0 — Bootstrap key.** Never held by a single party. Split across N shards using FROST (preferred) or GG20 threshold signing for secp256k1. Minimum viable N=3, threshold t=2. Shards live on: (a) a cold device the operator owns, (b) a hardware token, (c) a recovery shard held by a trusted second party or in a sealed geographic backup. The bootstrap key never signs outbound transactions directly — it only signs *rotation events* and *panic freezes*.

**Tier 1 — Session key.** Derived via BIP32/HKDF from a shard-reconstructed master seed. Short TTL (default: 24h, configurable down to minutes for high-value deployments). Policy-scoped via ERC-7579 modular session keys (Zerodev Kernel or Safe session key module). Each session key is issued with on-chain-enforced limits:

- `allowedTargets`: contract addresses it may call
- `allowedSelectors`: function selectors it may invoke
- `maxGasPerTx`, `maxValuePerTx`
- `validFrom`, `validUntil`
- `derivationIndex`

The session key is the only key that ever touches the running Node process. If it leaks, the damage is bounded by its policy scope and its TTL, and it will be rotated out within the current window.

## Migration path: EIP-7702 delegated EOA

ClawNet's existing EOA cannot be thrown away — it's already referenced by providers, schemas, and historical receipts. **EIP-7702** lets an EOA temporarily delegate to smart-wallet bytecode without changing its address. The plan:

1. Keep the existing EOA address as the stable public identity.
2. Use EIP-7702 to delegate that EOA to a Zerodev Kernel / Safe modular account.
3. Install an ERC-7579 session key module.
4. Rotation = mint/revoke session keys under that module. The EOA address never changes; only its active session key does.

This preserves the historical chain of receipts and provider relationships while giving us modular session-key semantics underneath.

## Core abstraction

```typescript
// src/heart/wallet-rotation.ts — Soma core, no EVM dependency
interface WalletBackend {
  stableAddress(): string;
  getActiveSessionKey(): SessionKey;
  rotateSessionKey(reason: 'scheduled' | 'panic' | 'policy-change'): Promise<RotationEvent>;
  revokeSessionKey(keyId: string, evidence: CompromiseEvidence): Promise<void>;
  signOutbound(tx: OutboundTx): Promise<SignedTx>;
  emergencyFreeze(): Promise<void>;
}

interface SessionKey {
  keyId: string;
  publicKey: string;
  validFrom: number;
  validUntil: number;
  allowedTargets: string[];
  allowedSelectors: string[];
  maxGasPerTx: string;
  maxValuePerTx: string;
  derivationIndex: number;
}

interface RotationEvent {
  protocol: 'soma-rotation/1';
  stableAddress: string;
  oldKeyId: string | null;
  newKeyId: string;
  reason: 'scheduled' | 'panic' | 'policy-change';
  rotatedAt: number;
  thresholdSignature: string; // bootstrap-key threshold sig
  anchor?: { chain: 'base'; txHash: string; attestationUid: string };
}

class WalletRotationController {
  constructor(
    backend: WalletBackend,
    policy: RotationPolicy,
    heartbeatChain: HeartbeatChain,
    rotationLog: RotationLog,
  );
  async signOnBehalfOfHeart(tx: OutboundTx): Promise<SignedTx>;
  async tick(): Promise<void>; // checks TTL, triggers scheduled rotation
  async panicRotate(evidence: CompromiseEvidence): Promise<RotationEvent>;
}
```

Soma core ships only the abstraction and the `WalletRotationController`. EVM specifics live in a separate package so alternative chains (Solana, Cosmos) can plug in.

## Package split

- `src/heart/wallet-rotation.ts` — core abstraction, policy engine, rotation controller, append-only rotation log.
- `@soma/evm-backend` — EIP-7702 delegation, Zerodev Kernel / Safe session key module, threshold signing via FROST for secp256k1, EAS anchoring.
- `@soma/secret-scanner` — pre-commit hook that would have caught the `cn-...` leak. See `secret-scanner.md`.

## Rotation log (public, append-only)

Every `RotationEvent` is appended to an on-disk hash-chained log mirroring `src/heart/revocation-log.ts`. The head is:

1. Published to ClawNet peers via gossip.
2. Anchored to EAS on Base every N rotations or every M hours, whichever comes first.
3. Exposed at `GET /v1/soma/rotation-log` for any observer to verify.

Because the log is signed by the threshold bootstrap key, a single compromised shard cannot forge rotation history. An attacker who steals a session key cannot retroactively rewrite the log to claim legitimacy.

## Panic rotate

Triggers (any one fires panic rotate):

- `reputation-aggregator` reports trust score below emergency floor for the active session key.
- `outcome-log` records more than K failed attestations in window W (configurable).
- `revocation-log` receives an external revocation for the current session key.
- Operator invokes `soma heart panic-rotate` from cold device with threshold signature.
- Anomaly detector flags outbound tx outside policy envelope.

Panic rotate fails closed: if the bootstrap shards cannot be reached in time, the heart enters `emergencyFreeze()` — stops signing, surfaces loud alarms, and refuses to serve until a human assembles the threshold.

## Invariants that must hold under public code review

1. **No single point of compromise grants long-term control.** Stealing a session key gives at most TTL-bounded, policy-bounded authority. Stealing one bootstrap shard gives nothing.
2. **Every rotation is publicly auditable.** Rotation log is append-only, anchored, and gossiped. A silent rotation is a protocol violation.
3. **Rotation is fail-closed.** If the rotation path itself fails, the heart stops signing. It never falls back to "keep using the old key."
4. **Derivation is deterministic and reproducible.** Given threshold shards, anyone can reconstruct the derivation path and verify historical session keys.
5. **Session key policy is enforced on-chain.** The policy is not advisory. The ERC-7579 module rejects out-of-policy calls at the smart account level, not just in client code.
6. **No secret-in-code.** The only secrets that ever live in the repo are test fixtures clearly marked as such. The secret scanner enforces this.

## Open questions

1. Which threshold scheme: FROST (newer, cleaner, fewer rounds) or GG20 (battle-tested)? Leaning FROST.
2. Can we avoid EIP-7702 by cutting over to a brand-new smart account? No — ClawNet's historical identity is load-bearing for receipts.
3. How often should the heart auto-rotate in normal operation? Default 24h; parameterize per-deployment.
4. Where do we publish rotation log heads when the VPS is unreachable? Need a fallback (IPFS pin? second anchor chain?).
5. How does Nova (first external heart) bootstrap its threshold shards? Probably out-of-band ceremony during the integration conversation.

## Build order

1. `@soma/secret-scanner` first — prevents the next leak while we build everything else.
2. `src/heart/wallet-rotation.ts` core abstraction + `WalletRotationController` + append-only rotation log.
3. In-memory mock backend + full test suite (rotation cadence, panic rotate, replay, log tamper, freeze).
4. `@soma/evm-backend` with EIP-7702 + Zerodev session key module + EAS anchoring.
5. Wire into ClawNet as the first production deployment (see `gameplan-post-1-1.md`).
6. Ship Nova as second production deployment and reference integration.

## Dogfood: apply the same mechanic to ClawNet API keys

Added 2026-04-10 — the idea is to reuse the exact tiered rotation primitive for ClawNet's own `cn-...` API keys rather than build a parallel one. Two benefits: (a) we harden the leaky surface that already bit us this session, (b) the first real-world stress test of the wallet-rotation primitive happens on our own infrastructure, not a customer's. If it cannot rotate an API key cleanly, it will not rotate an x402 settlement key cleanly either.

### The two-tier mapping

| Wallet rotation concept            | ClawNet API key equivalent                                     |
|------------------------------------|----------------------------------------------------------------|
| Tier 0 bootstrap key (cold, threshold) | Tier 0 **master API identity** — an `api_identity` row that never authenticates requests. It only signs *issuance* and *rotation* events for its child session keys. Shardable across operator devices for high-value accounts. |
| Tier 1 session key (hot, policy-scoped, TTL) | Tier 1 **session API key** `cn-...` — what clients actually present on every request. Short TTL (default 24h; configurable). Inherits policy from its Tier 0 parent: allowed endpoints, credit ceiling per window, IP allowlist, required Soma caveats. |
| Derivation via HKDF from shard-reconstructed seed | Derivation via HKDF from the Tier 0 secret, path `ck:{identity_id}:{rotation_index}`. Given the Tier 0 secret and index, the Tier 1 key is reproducible — so an auditor can verify any historical session key was legitimately derived without needing a side log. |
| ERC-7579 on-chain policy module | `api_key_policies` table checked at the Hono `checkApiKey` middleware. The policy is enforced at the request gate, not in client code. Out-of-policy calls fail closed with `code: POLICY_DENIED`. |
| Append-only rotation log, anchored | `api_key_rotation_log` table + periodic anchor into the pulse tree (DEATH/ROTATE leaves already exist). Consumers see a tamper-evident history of every issuance and revocation. |
| Panic rotate from cold device | `cn-master rotate --panic` CLI that takes the Tier 0 shard reconstruction, revokes every live Tier 1 key under that identity in one transaction, and emits a fresh one. Fails closed: if shards cannot be assembled, the identity enters frozen state and refuses all auth. |
| On-chain emergency freeze | DB-level `api_identities.frozen_at` column. `checkApiKey` middleware short-circuits to 403 on any frozen identity, independent of key validity. |

### Why this is actually the right shape

ClawNet API keys today have none of the above. A single leaked `cn-...` gives an attacker the full account for as long as they stay under the rate limit. The fix is *not* "rotate more often by hand" — the fix is "make rotation an automated primitive whose cost of rotation is near-zero". Once the cost is zero, TTL can be 1 hour without friction.

Specifically, the session key in this model is what every ClawNet SDK call carries. The SDK holds the Tier 0 secret, silently rotates the Tier 1 key on its own cadence, and the caller never sees the rotation. This is the same UX as EIP-7702 session keys: the user keeps a stable identity, and the actual authenticator rotates underneath them.

### What this costs us to NOT do

Every day we keep static `cn-...` keys as the only auth surface:

1. Another accidental paste like this session's leaks the *entire* account, forever, no recourse short of manual revocation.
2. Our SDK customers cannot enforce a "nothing ever touches disk for more than N hours" policy, which is table-stakes for regulated deployments.
3. The wallet rotation primitive goes to market without a production reference — Nova and third parties will have no proof that it survives real traffic.

### Dogfood sequence (fits inside the main build order above)

After step 3 (in-memory mock + tests green) and before step 4 (EVM backend), insert:

**3.5 — ClawNet API key backend.** Implement `WalletRotationBackend` as a ClawNet-internal adapter whose "chain" is the ClawNet database and whose "session key" is a `cn-...` row. This is a one-week carve-out: no on-chain dependency, no HSM, just SQLite + HKDF + the same `WalletRotationController` interface. The ClawNet API surface (Hono `checkApiKey`) becomes the first real consumer of the primitive. Every pass through `checkApiKey` becomes an integration test.

Benefits in order of size:
- We get tiered rotation on our own auth surface within days of the primitive being testable.
- Any bug in the core `WalletRotationController` surfaces under our own traffic before a customer ever touches it.
- The post-dogfood `@soma/evm-backend` is a second adapter, not the first one — meaning the abstraction has already been proven against two backends before it ships externally.
- Marketing: "we run our own auth on this" is the single strongest trust signal we can offer for an open-source security primitive.

### Open design questions specific to the API key adapter

1. **Backward compatibility.** Existing `cn-...` keys in the live DB need a migration path. Options: (a) treat them as Tier 0 master identities with a single non-rotating Tier 1 child (no behavior change until the customer opts in), (b) force-rotate on next login. Leaning (a) to avoid surprising live customers.
2. **Policy default.** What does a Tier 0 identity's default policy look like if the customer doesn't configure one? Probably "inherit whatever the Tier 0 identity's existing plan allows" — i.e. policy enforcement is opt-in initially and tightens over time.
3. **SDK rotation cadence.** Should the SDK rotate proactively (cron) or reactively (on 401)? Reactive is simpler and handles clock skew; proactive is cleaner for auditability. Probably both: reactive as the floor, proactive as the ceiling.
4. **Shared identity for org accounts.** If a team has 5 developers holding the Tier 0 secret, we need audit attribution — who triggered each rotation. Either sub-identity per developer, or a per-device subkey that signs rotation events for the org identity.
5. **Disaster recovery when the Tier 0 secret itself is lost.** For the wallet case, this is what threshold shards solve. For the API key case, there's no on-chain anchor — we'd either need the same threshold mechanism (good: consistent), or a provider-side escrow with strong auth (worse: centralizes risk, but simpler). Leaning "use the threshold mechanism for both and charge for it on high tiers."

The answer to #5 is probably the single biggest decision, because it determines whether the API key rotation mechanic is genuinely 10/10 under public code review or just "better than static keys." If we go threshold end-to-end, a stolen VPS with every `.env` file on it still cannot forge a new Tier 1 key — the attacker has to also compromise t-of-n shards held by other devices. That is the bar the wallet rotation doc sets, and there is no reason the API key flow should be weaker.
