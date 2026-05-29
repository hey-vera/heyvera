# Rotation Battle-Test & Roadmap (2026-04-11)

Status: **active** — live audit of the shipped credential-rotation stack plus the forward design for wallets, break-glass, and Soma agent primitives.
Supersedes nothing. Cross-references:
- `internal/backlog/credential-rotation-architecture.md` (design intent)
- `internal/backlog/wallet-rotation-architecture.md` (earlier wallet framing — partially superseded by §2 below)
- `internal/backlog/soma-rotation-controller-vision.md` (the PKI-substrate framing)
- `internal/active/gameplan-post-1-1.md` (source-of-truth sequencing)

---

## 0. What this doc is

Shadow-adoption Phase 1 is shipped. Before advancing — and before rotating any real
ClawNet secret — we battle-tested the stack end to end. This doc captures:

1. Findings from the audit (§1)
2. How to rotate wallet private keys without losing the public address (§2)
3. Soma agent primitives worth building next (§3)
4. How "leak → alert → rotate → safe" lives in the heart (§4)
5. Execution sequence (§5)

---

## 1. Audit findings (P0 → P2)

Surface covered: `soma-heart/credential-rotation/{types,controller,snapshot,index,backends/ed25519-identity}`, `claw-net/src/core/{api-key-rotation,rotation-adoption}`, `claw-net/src/middleware/auth.ts` shadow-check wiring, and the HTTP integration test at `tests/unit/api-key-rotation-middleware.test.ts`.

### P0 — must land before any real rotation

**P0.1 Vault encryption at rest.** `api_key_rotation_credentials.secret_key` and `api_key_rotation_identities.next_secret_key` are plaintext base64. Any backup = full exfil. Fix: AES-256-GCM with a KEK in `CREDENTIAL_VAULT_KEK`. Transparent read (unprefixed legacy rows decode plain, new writes always encrypt). Format: `v1:<b64(iv||ct||tag)>`.

**P0.2 Zero-fill correctness on revoke.** `revokeCredential` overwrites with 32 zero bytes; Ed25519 secret keys are 64 bytes. Not a secret leak (the UPDATE replaces the whole column), but produces a 32-byte buffer that later misbehaves in the grace-window verify path. Fix: `new Uint8Array(64)` and prefer NULL; treat NULL as revoked in `requireLiveCredential`.

**P0.3 Cosmetic zero-fill in `signWithCredential`.** Local decoded copy; does not touch the durable row. Delete the try/finally; add a one-line comment pointing at P0.1.

### P1 — functional / wiring

**P1.1 `adoptApiKey` not transactional.** Wrap the whole `adoptExistingBearer → controller.incept → INSERT adoption` sequence in a DB transaction with `INSERT OR IGNORE` on the adoption row; rollback the backend state on any throw. Blocks a concurrent split-brain where two callers for the same key both pass the existence check.

**P1.2 Shared `pendingAdoptBearer` slot.** Process-wide single slot; concurrent adoptions for different keys throw. Long-term fix: pass a `bearerOverride?: string` through `incept` (requires a Soma shim). Short-term: P1.1's transaction serializes adoption enough to make this a non-issue.

**P1.3 No rate limit on `incept` / `adoptApiKey`.** `enforceRateLimit` only fires in `rotate`. When the admin adoption route ships, add a per-admin budget.

**P1.4 Controller state is process-memory only.** For Phase 1 this is fine (`lookupByBearer` is DB-backed, we never rotate yet). Phase 2 needs `controller.snapshot()` → encrypted disk with boot-time restore.

**P1.5 `lookupByBearer` bypasses the controller effective-state machine.** Phase-1 deliberate; flag loudly and add a runtime assert that any bearer it resolves has `adoption.authoritative === 0` when Phase 2 lands.

**P1.6 Shadow-check runs on env keys and delegated child keys.** Pollutes `notAdopted` counter. Skip when `isEnvKey === true`; on delegated keys, shadow-check the *parent* (billing) key.

### P2 — hygiene

- Revoked/expired rotation credential rows never pruned. Add a daily cron.
- Shadow-check counters reset on restart — surface at `/v1/admin/rotation/metrics`.
- Dedicated `SELECT secret_key` helper instead of full-row reads for signing.
- `ClawNetApiKeyBackend` has no integration test for the actual rotate path (only shadow-check + adoption). Add one before Phase 2.

---

## 2. Rotating a wallet private key while keeping the public address

Direct rotation of an EOA keypair is impossible — address = hash(pubkey) = deterministic(privkey). Three workarounds, only one of which is right for ClawNet's hot wallets.

### 2a. Smart contract wallets (**the answer**)

On Base: use a Coinbase Smart Wallet or Safe. On Solana: use a program-owned PDA with an `authority` field. The contract/PDA address is stable; it carries an `owner` pointer to an EOA key. Rotation is a single on-chain txn, signed by the old owner, that updates the pointer.

Wins:
- Funds never move. Address customers paid to is unchanged.
- Gas cost is minimal (one `updateOwner` per rotation).
- The on-chain event doubles as an L3 external witness — free for Soma.
- Maps cleanly onto the `CredentialBackend` interface as a new Class-B backend (`BaseSmartWalletBackend`, `SolanaPdaBackend`).

Cost: latency bounded by block confirmation (seconds to minutes depending on chain + re-org tolerance).

### 2b. Threshold signatures (FROST / GG20 / CGGMP)

N parties hold shares of a joint keypair. A proactive-refresh protocol rotates *shares* without changing the aggregate public key. Mathematically clean, no on-chain txn, no gas. Right answer for a cold treasury when it becomes worth the engineering cost. Overkill for hot operational wallets.

### 2c. Delegation / session keys

Cold key owns the address and rarely rotates. Cold key signs a time-limited delegation to a hot key that rotates constantly. Exactly what Soma's `CredentialRotationController` already models for non-wallet credentials — apply the same shape to wallets via a cold→warm→hot ladder.

**Decision:** build 2a first (Base smart wallet + Solana PDA wrappers), use 2c as the mental model, defer 2b until cold treasury makes it worth the complexity. The current `wallet-rotation-architecture.md` assumes raw EOA rotation with fund migration — update that doc to point here.

---

## 3. Soma agent primitives worth building next

> **Concrete composition:** these primitives compose into the session-mode
> + human-consent ceremony designed in
> [`session-mode-and-ceremony.md`](./session-mode-and-ceremony.md). That
> doc is the blueprint for PR-A (Soma `HumanDelegation`), PR-B
> (`HeartRuntime.createSession` + `CeremonyPolicy`), and PR-C (ClawNet
> `/v1/auth/session-*` routes). Canary credentials (§3.6) are the
> independent parallel track.

Six primitives that compose into a secure-autonomous-agent kit. Prioritized.

**3.1 Vault** (the generalization of `CredentialRotationController`). Every secret the agent touches — API keys, wallet keys, OAuth, DB creds, model keys — is a typed vault entry with class, TTL, rotation policy, access log, break-glass rules. Agent never handles raw bytes; the vault signs/encrypts on its behalf. ClawNet's rotation stack is the first slice.

**3.2 Break-glass primitive**. Pre-committed rotation events signed at inception, dormant until a signed `CompromiseSuspected` event from an authorized observer triggers them. KERI pre-rotation is the L1 building block; Soma needs the trigger wrapper around it. **This is the primitive most worth lifting into Soma proper, not building inside ClawNet.**

**3.3 Outcome log / regret primitive**. Birth certs prove who signed *data*. Nothing today proves who took *actions* or whether they worked. Agent writes outcome entries (`tried X expecting Y, got Z, cost W, reversible?`) into an append-only log. This is the teeth for Soma 1.2's reputation aggregator. Cheapest high-leverage thing we're not building yet.

**3.4 Capability tokens (UCAN-style)**. Partially there via `delegation.ts`. What's missing: attenuation, composition, revocation propagation, capability-gated sessions. Lets a 400-endpoint fleet collapse from 400 per-endpoint decisions into one capability mint.

**3.5 Quorum primitive**. First-class `ConsentRequired { action, quorum, witnesses, expires }` → `ConsentGranted` objects. Heart refuses high-stakes actions without matching consent. Quorum members can be humans, other agents, or on-chain oracles.

**3.6 Budget ledger**. Typed, composable budgets (USDC, credits, calls/hr, CPU-seconds). Overspend = heart refuses to sign. ClawNet has hard-budget-lock; Soma should make it protocol-native.

**Priority trio:** Vault + break-glass + outcome log. Capability tokens and quorum ride on top of them. Budget ledger is the cherry.

---

## 4. "Leak → alert → rotate → safe" in the heart

Walking the flow for the target agent (5 coding APIs + 400 x402 endpoints + multiple wallets + human-gated high-stakes decisions).

### 4a. Inception

- Agent incepts a heart with genome commitment and a cold root key.
- Vault registers every credential with class + policy:
  - 5 coding API creds (Class C, third-party)
  - 400 x402 endpoint creds (Class B, short TTL, mostly capability-gated)
  - Wallets (Class B, smart-contract-wallet backed)
  - Human approver pubkey (cold, manual rotation only)
- For every vault entry the controller runs KERI pre-rotation: the *next* key is generated and its manifest commitment is baked into the *current* credential.
- A **sense-observer** (different party — separation of powers) registers as witness with authority to trigger break-glass on specific credential classes.
- A **dormant break-glass rotation event** is signed at inception by a three-party quorum (cold key + observer + human) for every credential and stashed in the heart's encrypted snapshot.

### 4b. Steady state

Every action flows through the heart:
- `heart.callTool(...)` → vault fetches credential → request → chain records `tool_call → tool_result → birth_certificate` signed by the *effective* credential.
- `heart.spend({ amount })` → budget ledger check → if over threshold, heart emits `ConsentRequired` and refuses to sign until human PoP challenge returns.
- `heart.x402(...)` → capability token verified → signing via the credential bound to that capability.

The heartbeat chain is what the observer mirrors and what downstream verifiers replay.

### 4c. Leak evidence sources

1. **Observer anomaly** — split-brain signatures, burst/scope deviation.
2. **Canary** — honeytoken credential registered in the vault but declared unusable in the genome. Any attempted use = certain leak. Cheapest, highest-signal detector.
3. **On-chain watcher** — wallet signs a txn with no matching heartbeat.
4. **External SIEM / secret scanner** over a pre-registered signed channel.

### 4d. Break-glass flow

1. Observer (or heart self-detecting a canary) emits `CompromiseSuspected{credentialId, evidence, observerSig}`.
2. Heart verifies observer sig, checks policy (automatic for Class A, requires co-sign for Class B).
3. Heart immediately marks the suspect credential `suspended` — no sign, verify still allowed for grace window.
4. Heart loads the pre-committed break-glass event from the sealed snapshot. Because of L1 pre-commitment no fresh signature from the compromised key is needed.
5. Heart publishes the rotation event to the pulse tree + at least one external witness (L3). On both, the new credential becomes `effective`.
6. For wallets: heart calls `rotateOwner(newOwner, oldSig)` on the smart contract wallet as the *last act* of the old key. Funds stay at the same address.
7. Heart emits `BreakGlassTriggered` signed by the NEW credential, carrying evidence + rotation event hash. Observer counter-signs. Human approver paged via signed channel.
8. Pending actions re-signed with the new credential. Old credential grace window absorbs in-flight verifiers.
9. Outcome log gets `break_glass{credentialId, trigger, outcome}` — food for the reputation aggregator.

Wall-clock: single-digit seconds for Class A, tens of seconds to minutes for Class B (bounded by chain confirmation).

### 4e. Heart's role boundaries

**Heart does:**
- Trust root — knows which credentials are the agent's.
- Enforcement point — every action routes through `heart.*`, so the heart chooses which credential signs.
- Audit anchor — heartbeat chain is the single replay surface.
- Rotation orchestrator — pre-committed events mean even an air-gapped heart rotates without phoning home.

**Heart does NOT:**
- Detect compromise (observer's job — a compromised heart can't be trusted to report its own compromise).
- Store raw secrets (vault holds them behind the KEK).
- Make break-glass policy alone (quorum + observer co-sign for high-value classes).

---

## 5. Execution sequence

Ordered for "right now we want keys rotated for security and helpful for agents."

1. **P0.1 vault encryption** (`src/core/vault-crypto.ts` + `CREDENTIAL_VAULT_KEK` + `api-key-rotation.ts` wrap + migration 200 no-op). Hard prereq.
2. **P0.2 + P0.3 + P1.6** in a single cleanup PR.
3. **P1.1 transactional adopt.**
4. **Canary credential type + handler.** Cheapest, highest-signal compromise detector. Phase 1-compatible.
5. **Break-glass event type + heart handler** (Soma side). Define `CompromiseSuspected` / `BreakGlassRotation` as heartbeat event types; handler loads pre-committed next credential and walks it through the controller.
6. **Wire sense-observer → break-glass trigger.** Observer gets a new capability: emit signed `CompromiseSuspected`. Heart accepts from allowlisted observers per class.
7. **`BaseSmartWalletBackend`** (ClawNet or Soma side — lean Soma so other operators inherit). Implements `CredentialBackend` where `rotate()` is the on-chain `updateOwner` txn.
8. **Quorum witness primitive.** Minimal version: heart refuses to sign any Class-B rotation or any spend above threshold without a `ConsentGranted` signed by a pre-registered human key.
9. **Outcome log.** Extend heartbeat chain to record action outcomes, not just data provenance.

Steps 1-4 give the scenario-for-API-keys. Step 7 extends it to wallets without fund migration. Step 8 adds the human gate. Step 9 is the learning substrate.

Architectural notes:
- Build break-glass and outcome log in **Soma**, not ClawNet. ClawNet is the first consumer, not the owner. Protocol-purity rule holds.
- Smart-contract-wallet backend is a new Class-B implementation — do NOT try to retrofit the Ed25519 identity backend for it.
- Human approver signing is a key primitive — treat it as "a heart with only one capability" so it reuses all of Soma's DID/PoP machinery instead of inventing a new auth path.

---

## Memory pointers updated

Add a line to `MEMORY.md` pointing here. This doc is the current source-of-truth for rotation battle-test status; the design intent still lives in `internal/backlog/credential-rotation-architecture.md`.
