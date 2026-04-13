# Session Mode — ClawNet Wiring

**Status:** active — Soma primitives shipped, ClawNet wiring pending (PR-C)
**Soma design doc:** `Soma/docs/design/session-mode.md` (architectural
blueprint, primitive specs, ceremony tiers). Read that first.
**Owners:** Josh + Claude

This doc only covers what **ClawNet** needs to do to consume Soma's
session-mode primitives. The architecture, the `HumanDelegation` type,
the `CeremonyPolicy` engine, the `HumanSessionRegistry`, and the tier
definitions all live in the Soma repo as first-class Soma design — Soma
is the machine, ClawNet is the first consumer.

## What Soma already ships

- `createHumanDelegation` / `verifyHumanDelegation` / `computeChallengeHash`
- `createCeremonyPolicy` with fail-safe defaults (read=L0, write=L1,
  spend/deploy=L2, admin=L3, unknown=L2)
- `HumanSessionRegistry` — verified-open, invoke gating, budget +
  invocation drain, terminal states, `prune`, `revoke`
- `consent_required` / `consent_granted` heartbeat event types
- Pluggable `AttestationVerifier` — Soma is WebAuthn-agnostic by design

ClawNet does not extend any of these. It imports them and wires them to
HTTP.

## PR-C — ClawNet session routes (next build)

Four routes, all gated on Clerk auth because the *human* is the Clerk
user:

```
POST /v1/auth/session-begin     → computes challenge, returns QR/deep-link
POST /v1/auth/session-confirm   → verifies attestation, creates session,
                                  returns session token
POST /v1/auth/session-escalate  → mid-session bump to higher tier
POST /v1/auth/session-end       → explicit close
```

Session tokens are opaque bearer strings the harness presents on
subsequent calls. They map internally to a `HumanSession` row in the
registry.

### Attestation verifier

ClawNet writes a `clawnetAttestationVerifier` function that:

1. Parses a WebAuthn `AuthenticatorAssertionResponse` out of the
   request body.
2. Validates it against the registered credential for the human's
   Clerk user (stored at enrollment time).
3. Maps the authenticator type to a `CeremonyTier`:
   - Platform (Touch ID, Windows Hello) → L1
   - Cross-platform hardware key (YubiKey, Solo) → L2
   - L2 + a second factor (hardware SSH signature) → L3
4. Returns `{ ok: true, tier }` or `{ ok: false, reason }`.

That function is the **only** browser-crypto code ClawNet writes. Soma
itself stays clean.

### Enrollment

A new dashboard page: `dashboard/src/pages/auth/register-authenticator.tsx`.

- Calls `POST /v1/auth/enroll-begin` → gets a WebAuthn registration
  challenge
- Browser calls `navigator.credentials.create(...)`
- Calls `POST /v1/auth/enroll-finish` with the attestation
- ClawNet stores the credential id + public key against the Clerk user
  id

No Soma involvement — this is all ClawNet → WebAuthn.

### Database

New tables (migration append to `src/db/connection.ts`):

```sql
CREATE TABLE human_authenticators (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  tier_hint TEXT NOT NULL, -- 'L1' | 'L2' | 'L3'
  registered_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE human_sessions (
  session_id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  human_did TEXT NOT NULL,
  agent_ephemeral_did TEXT NOT NULL,
  delegation_json TEXT NOT NULL, -- serialized HumanDelegation
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  remaining_credits INTEGER,
  remaining_invocations INTEGER
);
```

The ClawNet `HumanSessionRegistry` instance is hydrated from
`human_sessions` on startup and persisted on every mutation. That's
the one bit of state-management work that's ClawNet-side — Soma's
registry is pure in-memory by design.

## Composition with existing ClawNet auth

ClawNet already has three auth layers (API key, Clerk, Admin). Session
mode is a **fourth** layer *on top of* Clerk:

- Clerk authenticates the human.
- Session mode gates what the *harness acting for that human* is allowed
  to do within a time-bounded envelope.
- Legacy `cn-...` API keys keep working as a pre-existing billing
  primitive; session tokens route to the same usage metering.

Routes that require high ceremony (e.g. payout endpoints, escrow
resolution, admin) will read the session's tier and reject if
`CeremonyPolicy` says no. Low-ceremony routes stay on plain Clerk.

## Harness trust boundary

A harness on the user's laptop is inside the trust boundary of a laptop
attacker. A harness on a hardened VPS (guardian-vps) with its own
sealed identity narrows that boundary. For high-stakes actions, prefer
the VPS-hosted harness; for dev work, the laptop is fine but actions
that move money or touch production should require L2+ ceremony via
`CeremonyPolicy` overrides.

This is a **ClawNet operational decision**, not a Soma one — Soma
doesn't know what a VPS is.

## ClawNet-specific open questions

- **Enrollment UX** — do we force WebAuthn at Clerk signup, or make it a
  one-time upgrade the first time a session is needed? Lean: upgrade on
  first use, pop a modal.
- **Session token format** — opaque random bytes or signed JWT? Opaque
  is simpler; JWT is stateless but requires key management. Lean:
  opaque, registry is already stateful.
- **Dashboard session management** — users should be able to see
  active sessions and revoke them. Out of scope for PR-C, add in PR-C.1.

## Build order (ClawNet side)

- **PR-C.1** — DB migrations + `HumanSessionRegistry` hydration glue
- **PR-C.2** — `clawnetAttestationVerifier` + enrollment routes +
  dashboard page
- **PR-C.3** — `/v1/auth/session-*` routes, gated on Clerk
- **PR-C.4** — policy overrides for ClawNet-specific action classes
  (voice-call, admin-resolve, etc.) + wiring gatekeepers onto existing
  high-stakes routes

## Cross-refs

- `Soma/docs/design/session-mode.md` — the architectural blueprint
- `Soma/src/heart/human-delegation.ts`, `ceremony-policy.ts`,
  `human-session.ts` — the primitives
- `internal/active/rotation-battle-test-and-roadmap.md` §3 — agent
  primitives roadmap
- `internal/active/gameplan-post-1-1.md` step 4 — where this slots
  into the overall plan
