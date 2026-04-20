# Proposal: WebAuthn + UpdateCertificate — Securing Soma Releases Through ClawNet Heart

**Status:** proposed → ready for implementation  
**Author:** Claude (research synthesis), decisions by Josh  
**Date:** April 20, 2026  
**Version:** 3 (authenticator registry, upgrade path)  
**Depends on:** UpdateCertificate (PR #75, shipped), api-key-rotation.ts, rotation-backend.ts  
**Repos:** soma (`src/supply-chain/update-certificate.ts`), claw-net (`src/core/soma-heart.ts`)

---

## 1. Executive Summary

This proposal designs a WebAuthn-gated signing ceremony for Soma releases, where the founder's biometric authentication through the ClawNet heart is the sole authority for approving UpdateCertificates. The founder authenticates via Apple passkey (primary, synced via iCloud Keychain) or Google passkey (backup, synced via Google account), with an offline Ed25519 recovery seed as catastrophic backup. CI publishes to npm first, then the founder completes a WebAuthn ceremony at their convenience — no pipeline blocking. Signed certificates are distributed at `/.well-known/soma-updates.json` on claw-net.org (authoritative) and as a convenience copy in the npm package. Both a dashboard UI and a CLI ship from day one as production paths.

The authenticator registry is a first-class protocol concept: every credential has an explicit role (primary, backup, recovery) with defined lifecycle operations (add, promote, demote, revoke). The system supports upgrading authenticators (e.g., adding a YubiKey as primary, demoting passkeys to backup) without ceremony redesign.

---

## 2. Research Findings

### 2.1 WebAuthn/FIDO2 State of the Art (2025–2026)

WebAuthn is a W3C standard supported across all major browsers (Chrome, Firefox, Edge, Safari) and platforms (Windows, macOS, Android, iOS). The core flow is well-established: registration generates a public-private keypair where the private key never leaves the authenticator, and authentication requires proving possession of that private key by signing a server-generated challenge. Domain binding provides phishing resistance by cryptographically tying credentials to the origin that created them.

**SimpleWebAuthn** (`@simplewebauthn/server` v13.x, `@simplewebauthn/browser` v13.x) is the leading Node.js/TypeScript library for WebAuthn integration. It is actively maintained, supports Node LTS 20+, runs on Deno and Cloudflare Workers, covers all attestation formats (Packed, TPM, Android Key, Apple, FIDO U2F, None), and has ~3M weekly downloads on npm. Its API surface is clean: `generateRegistrationOptions()` / `verifyRegistrationResponse()` for enrollment, `generateAuthenticationOptions()` / `verifyAuthenticationResponse()` for authentication. This is the implementation choice for ClawNet.

### 2.2 Passkey Ecosystems for Signing Ceremonies

The founder's decision to use synced passkeys (Apple iCloud Keychain as primary, Google Password Manager as backup) trades hardware-bound non-exportability for practical resilience across devices. This is a deliberate and informed choice.

**What synced passkeys provide:** The private key is stored in the platform's secure enclave and synced end-to-end encrypted across all devices in the ecosystem. If the founder's MacBook is destroyed, the passkey survives on their iPhone and vice versa. Cross-ecosystem coverage (Apple + Google) means the founder is not locked into a single vendor's availability.

**What synced passkeys do not provide:** NIST SP 800-63B-4 AAL3 compliance (which requires non-exportable keys) and device attestation (which requires a hardware-bound manufacturer certificate chain). For Soma's threat model, AAL3 is not a regulatory requirement, and the practical resilience of multi-device sync outweighs the theoretical purity of hardware-bound keys.

**Security posture:** Compromise requires access to the founder's Apple ID or Google account AND their device biometrics. Both ecosystems require biometric or PIN verification before releasing a passkey for use. The WebAuthn ceremony always sets `userVerification: 'required'`, ensuring the authenticator confirms the founder's identity before signing.

### 2.3 Recovery Patterns in Production Systems

**GitHub's model:** Multiple authentication methods (passkeys, security keys, TOTP, SMS, recovery codes). If all 2FA credentials and recovery codes are lost, account recovery requires identity verification via SSH key, personal access token, or previously verified device — with a 3–5 business day review period. GitHub explicitly states that Support may not be able to restore access if all recovery methods are lost.

**Coinbase's model:** Recovery codes saved at setup. Without them, identity verification via government-issued photo ID and video selfie. The process is deliberately slow (days) to prevent social engineering.

**Crypto wallet recovery (Shamir's Secret Sharing):** Trezor (SLIP-0039) and Ledger Recover (Pedersen's Verifiable Secret Sharing) split master secrets into N shares with threshold K. In a 2-of-3 scheme, any two shares reconstruct the secret. The mathematical guarantee is information-theoretic security — knowledge below threshold provides zero advantage.

**Key takeaway for Soma:** No production system relies on a single authenticator without a recovery path. The founder's layered approach (two passkey ecosystems + offline seed) mirrors industry best practice without distributing authority to other parties.

### 2.4 npm Supply Chain Signing (Sigstore)

npm integrates Sigstore for package provenance attestations via `sigstore-js`. Provenance establishes *where* a package was built and *which CI identity* published it, but does not establish *human authorization*. The Soma ceremony system fills this exact gap. They are complementary: Sigstore proves CI-to-tarball integrity, UpdateCertificate proves human-to-CI authorization.

---

## 3. Design Decisions (Founder-Specified)

| # | Decision | Rationale |
|---|---|---|
| 1 | Dashboard + CLI ship together in Phase 1 | Both are production paths. CLI opens dashboard URL and polls for completion. |
| 2 | Certificates are permanent. Ceremony *requests* expire after 72 hours. | Certificates attest historical facts. Requests have a window because uncompleted ceremonies shouldn't linger. |
| 3 | Apple passkey primary. Google passkey backup. Offline Ed25519 recovery seed with 72h time-lock. No hardware key vault. | Multi-ecosystem passkey resilience. Recovery seed is catastrophic backup only. |
| 4 | CI publishes first, ceremony request follows. No pipeline blocking. | Decoupled flow. Founder authenticates when convenient. |
| 5 | `.well-known/soma-updates.json` on claw-net.org is authoritative. npm package metadata is convenience copy. `.well-known` wins on disagreement. | Single source of truth with offline-verifiable convenience copy. |
| 6 | Authenticator upgrade path is first-class. Protocol supports add, promote, demote, revoke without ceremony redesign. | Future YubiKey upgrade doesn't require protocol changes. Storage medium irrelevant — only public key hash matters. |

---

## 4. Authenticator Registry

### 4.1 Role Model

Every registered credential has an explicit role that determines its behavior in WebAuthn ceremonies:

| Role | Included in `allowCredentials`? | Semantics |
|---|---|---|
| **primary** | Yes — presented first | Default authenticator for all ceremonies. The system prompts with this credential first. |
| **backup** | Yes — included as fallback | Included in `allowCredentials` alongside primary. Used when primary is unavailable. |
| **recovery** | **No** — dedicated recovery flow only | Never included in normal ceremony `allowCredentials`. Only activates through the dedicated recovery endpoint. This prevents a compromised recovery seed from being silently used during routine ceremonies. |

### 4.2 Registry Invariants

The system enforces these invariants at all times:

1. **Exactly one active primary.** Promoting a credential to primary automatically demotes the current primary to backup.
2. **Exactly one active recovery.** Registering a new recovery credential revokes the previous one (after confirmation).
3. **Revoked credentials are never deleted.** They remain in the registry with `status: 'revoked'` and `revoked_at` timestamp for audit trail.
4. **At least one active non-recovery credential must exist.** The system prevents revoking the last active primary/backup credential.
5. **Recovery credentials are excluded from normal ceremonies.** The `allowCredentials` list for standard WebAuthn authentication never includes recovery-role credentials.
6. **Storage medium is irrelevant to the protocol.** The protocol stores a public key. Whether the private key lives in iCloud Keychain, a YubiKey, a piece of paper, or a steel plate in a fireproof safe is outside the protocol's concern. Only the public key hash matters.

### 4.3 Lifecycle Operations

| Operation | Endpoint | Effect |
|---|---|---|
| **Add** | `POST /api/authn/register` | Register a new credential. WebAuthn registration flow. Caller specifies intended role and ecosystem label. |
| **Promote** | `POST /api/authn/promote` | Change a backup credential to primary. Current primary auto-demotes to backup. Requires WebAuthn auth with current primary. |
| **Demote** | `POST /api/authn/demote` | Change primary to backup. Only valid if another credential is simultaneously promoted (atomic swap). |
| **Revoke** | `POST /api/authn/revoke` | Mark a credential as revoked. Cannot revoke the last active non-recovery credential. Requires WebAuthn auth with a different active credential. |
| **Roster** | `GET /api/authn/roster` | List all credentials with roles, ecosystems, creation dates, last-used dates, and status. |

### 4.4 Authenticator Upgrade Scenario

Example: Founder acquires a YubiKey and wants to make it primary.

1. `POST /api/authn/register` — Register YubiKey with `intendedRole: 'primary'`
2. System performs WebAuthn registration with the YubiKey
3. YubiKey is registered as primary; Apple passkey is automatically demoted to backup
4. Google passkey remains backup; offline seed remains recovery
5. Ceremony flow is identical — `allowCredentials` now presents YubiKey first, then Apple and Google as fallbacks
6. No ceremony redesign, no protocol changes, no migration

---

## 5. Ceremony Flow Design

### 5.1 Phase A: WebAuthn Enrollment

The founder registers their passkey credentials with the ClawNet heart. Two enrollments are required: Apple passkey (primary) and Google passkey (backup).

**Flow:**

1. Founder authenticates to ClawNet dashboard via existing Clerk auth.
2. Founder navigates to "Soma Signing Authority" settings panel.
3. ClawNet server calls `generateRegistrationOptions()` with:
   - `rpName: 'ClawNet Soma Signing'`
   - `rpID: 'claw-net.org'`
   - `userName: founder's Clerk user ID`
   - `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`
   - `supportedAlgorithmIDs: [-7, -257]` (ES256, RS256)
   - `attestationType: 'none'` (synced passkeys cannot provide meaningful attestation)
4. Browser calls `startRegistration()` — system passkey prompt appears (Touch ID / Face ID / Google prompt).
5. ClawNet server calls `verifyRegistrationResponse()`, extracts public key and credential ID.
6. Server stores in `webauthn_credentials` table:
   - `credential_id` (base64url)
   - `public_key` (base64url-encoded COSE key)
   - `counter` (signature counter for replay detection)
   - `transports` (internal, hybrid — for authentication hints)
   - `aaguid` (authenticator model identifier)
   - `created_at`, `last_used_at`
   - `ecosystem` ('apple' | 'google' | 'yubikey' | 'other')
   - `role` ('primary' | 'backup' | 'recovery')
   - `status` ('active' | 'revoked')
   - `revoked_at` (null unless revoked)
7. Founder repeats enrollment for Google passkey (different browser/device signed into Google account).
8. Server generates the **offline recovery seed** (256-bit random), derives an Ed25519 keypair, stores only the recovery public key with `role: 'recovery'`. The seed is displayed once and never stored.

**CLI enrollment path:** `npx soma-sign enroll` opens `https://claw-net.org/ceremony/enroll` in the default browser. The same WebAuthn flow runs in the browser. The CLI polls `GET /api/ceremony/enroll/status` until enrollment completes.

**CLI registry commands:**
- `npx soma-sign authn add` — Register a new credential (opens browser)
- `npx soma-sign authn promote <credential-id>` — Promote to primary
- `npx soma-sign authn roster` — List all credentials with roles and status

### 5.2 Phase B: Update Signing Ceremony

**Flow:**

1. **CI publishes to npm.** GitHub Action runs `npm publish --provenance`. Tarball is live on npm with Sigstore attestation.

2. **CI sends ceremony request.** After successful publish, the action POSTs to `https://claw-net.org/api/ceremony/request`:
    {
      "package": "soma-heart",
      "targetVersion": "0.9.0",
      "tarballSha256": "<64-char hex>",
      "gitCommit": "<sha>",
      "releaseLogSequence": 42,
      "releaseLogEntryHash": "<hash>",
      "oidcToken": "<github-actions-jwt>"
    }

3. **ClawNet validates and creates pending ceremony.** The server:
   - Validates the OIDC token against GitHub's JWKS
   - Verifies the source repo matches expected (`josh/soma`)
   - Creates a `pending_ceremonies` record: status `awaiting_webauthn`, `expires_at = now + 72h`
   - Sends notifications (email, Slack webhook)

4. **Founder authenticates.** Two production paths:

   **Dashboard path:** Founder visits `https://claw-net.org/ceremony/<ceremony-id>`. Reviews release details (package, version, tarball hash, git commit). Clicks "Authorize Release." WebAuthn challenge is presented. Founder authenticates with primary passkey (or backup).

   **CLI path:** Founder runs `npx soma-sign authorize`. The CLI:
   - Fetches pending ceremonies from `GET /api/ceremony/pending`
   - Displays ceremony details in terminal
   - Opens `https://claw-net.org/ceremony/<id>` in default browser for WebAuthn authentication
   - Polls `GET /api/ceremony/<id>/status` every 2 seconds
   - Prints success/failure when ceremony completes

5. **WebAuthn verification.** ClawNet server:
   - Calls `generateAuthenticationOptions()` with `rpID: 'claw-net.org'`, `userVerification: 'required'`
   - `allowCredentials` includes primary and backup credentials only (never recovery)
   - The challenge encodes the SHA-256 of the ceremony payload
   - Calls `verifyAuthenticationResponse()` — validates signature, checks counter
   - Verifies challenge matches pending ceremony

6. **ClawNet heart co-signs.** On successful WebAuthn verification:
   - Maintainer's authorization is created via `createUpdateCertificate()` with `role: 'maintainer'`, `ceremonyTier: 'L2'`
   - ClawNet heart calls `addAuthorization()` with its own Ed25519 keypair, `role: 'consumer-heart'`
   - Certificate has `threshold: 2`, `expiresAt: null` (permanent)
   - The `delegationHash` field on the maintainer authorization links to the WebAuthn ceremony record for audit trail

7. **Certificate is distributed:**
   - Written to `/.well-known/soma-updates.json` on claw-net.org (authoritative)
   - Published as a convenience copy in the next npm package version's `package.json` metadata (or as a sidecar file)
   - Ceremony status updated to `completed`
   - `authenticatorKind` recorded on the ceremony (informational/audit — records which type of credential signed)
   - Optionally anchored on-chain via EAS

8. **Request expiry.** If the founder does not complete WebAuthn within 72 hours:
   - `pending_ceremonies` record status → `expired`
   - No certificate is issued
   - A new `npm publish` cycle is required to create a fresh ceremony request

### 5.3 Phase C: Verification by Downstream Consumers

Consumers verify using the existing `verifyPackageProvenance()` function (shipped, 571 LOC):

1. Fetch the UpdateCertificate from `https://claw-net.org/.well-known/soma-updates.json` (authoritative) or from the npm package metadata (convenience copy).
2. If both sources are available and disagree, `.well-known` wins.
3. Call `verifyPackageProvenance()` with:
   - `trustedMaintainers: [founderDid]`
   - `trustedConsumerHearts: [clawNetHeartDid]`
4. No new verification code needed.

### 5.4 `.well-known/soma-updates.json` Schema

    {
      "version": "1",
      "packages": {
        "soma-heart": {
          "0.9.0": {
            "certificate": { /* full UpdateCertificate object */ },
            "ceremonyCompletedAt": "2026-04-20T14:30:00Z",
            "authenticatorKind": "apple-passkey",
            "sigstoreBundle": "<optional link to Rekor entry>"
          }
        }
      },
      "signingAuthority": {
        "maintainerDid": "did:key:z...",
        "consumerHeartDid": "did:key:z..."
      }
    }

---

## 6. Recovery Mechanism

### 6.1 Three-Layer Recovery Architecture

| Layer | Authenticator | Role | Failure it handles | Standing backdoor? |
|---|---|---|---|---|
| **Primary** | Apple passkey (iCloud Keychain) | primary | Device loss/damage — passkey syncs across all Apple devices | No — only founder's Apple ID + biometrics |
| **Backup** | Google passkey (Google Password Manager) | backup | Apple ecosystem outage, Apple ID lockout | No — only founder's Google account + biometrics |
| **Catastrophic** | Offline Ed25519 recovery seed (paper/steel, never on a server) | recovery | Both passkey ecosystems compromised/lost, VPS destroyed | No — seed is never stored; 72h time-lock provides detection window |

### 6.2 Recovery Seed Activation Flow (Phase 3)

1. Founder initiates recovery at `POST /api/authn/recovery/initiate` with the Ed25519 seed signature
2. Server verifies signature against stored recovery public key
3. **72-hour time-lock begins.** Server announces the recovery initiation via all configured notification channels (email, Slack, dashboard banner)
4. During the 72-hour window, the founder can cancel the recovery from any authenticated session (if they have access to a non-recovery credential)
5. After 72 hours without cancellation, the recovery completes: founder can register new passkey credentials
6. Old credentials are revoked; new credentials take their roles

### 6.3 Why Not M-of-N or Shamir's SSS?

M-of-N threshold schemes and Shamir's Secret Sharing are designed to distribute signing authority across multiple parties. This directly conflicts with the sole-authority requirement — the entire point is that only the founder can authorize Soma releases. Distributing trust is the opposite of what this system needs.

The three-layer model achieves resilience without distributing authority: each layer is independently sufficient (sole-authority preserved) and each requires the founder's personal credentials (Apple ID + biometrics, Google account + biometrics, or physical seed possession).

---

## 7. Implementation Phases

### Phase 1: Foundation (3–4 weeks) — THIS PROPOSAL'S SCOPE

- WebAuthn enrollment (Apple primary + Google backup)
- Authenticator registry with roles (primary/backup/recovery)
- Registry API: `/api/authn/register`, `/promote`, `/demote`, `/revoke`, `/roster`
- Manual ceremony flow (dashboard-triggered, no CI integration yet)
- `pending_ceremonies` table with 72h expiry
- Dashboard UI: enrollment page, ceremony approval page, registry roster view
- CLI: `npx soma-sign enroll`, `npx soma-sign authorize`, `npx soma-sign status`
- CLI registry: `npx soma-sign authn add`, `npx soma-sign authn promote`, `npx soma-sign authn roster`
- Offline recovery seed generation and public key storage

### Phase 2: CI Integration (1–2 weeks)

- GitHub Action for `npm publish --provenance` → ceremony request POST
- OIDC token validation against GitHub's JWKS
- Automated notification pipeline (email, Slack)
- End-to-end flow: CI publish → ceremony request → founder WebAuthn → certificate issued

### Phase 3: Recovery Hardening (2 weeks)

- Offline Ed25519 recovery seed activation flow with 72-hour time-lock
- Cancellation mechanism during time-lock window
- Notification channels for recovery initiation alerts
- Recovery flow testing and documentation

### Phase 4: Certificate Distribution + Optional Anchoring (2 weeks)

- `/.well-known/soma-updates.json` endpoint on claw-net.org
- npm package sidecar for convenience copy
- Conflict resolution (`.well-known` authoritative)
- Optional EAS on-chain anchoring

Each phase ships independently. Phase 1 is sufficient for manual ceremony use.

---

## 8. Database Schema

### `webauthn_credentials` table

| Column | Type | Notes |
|---|---|---|
| id | TEXT PRIMARY KEY | UUID |
| credential_id | TEXT UNIQUE NOT NULL | base64url WebAuthn credential ID |
| public_key | TEXT NOT NULL | base64url-encoded COSE public key |
| counter | INTEGER NOT NULL DEFAULT 0 | Signature counter for replay detection |
| transports | TEXT | JSON array: ['internal', 'hybrid'] |
| aaguid | TEXT | Authenticator model identifier |
| ecosystem | TEXT NOT NULL | 'apple', 'google', 'yubikey', 'other' |
| role | TEXT NOT NULL | 'primary', 'backup', 'recovery' |
| status | TEXT NOT NULL DEFAULT 'active' | 'active', 'revoked' |
| created_at | TEXT NOT NULL | ISO 8601 |
| last_used_at | TEXT | ISO 8601, updated on each successful auth |
| revoked_at | TEXT | ISO 8601, null unless revoked |

### `pending_ceremonies` table

| Column | Type | Notes |
|---|---|---|
| id | TEXT PRIMARY KEY | UUID |
| package_name | TEXT NOT NULL | e.g., 'soma-heart' |
| target_version | TEXT NOT NULL | e.g., '0.9.0' |
| tarball_sha256 | TEXT NOT NULL | 64-char hex |
| git_commit | TEXT NOT NULL | Full SHA |
| release_log_sequence | INTEGER | Monotonic sequence number |
| release_log_entry_hash | TEXT | Hash of the release log entry |
| status | TEXT NOT NULL DEFAULT 'awaiting_webauthn' | 'awaiting_webauthn', 'completed', 'expired', 'cancelled' |
| expires_at | TEXT NOT NULL | ISO 8601, created_at + 72h |
| completed_at | TEXT | ISO 8601 |
| authenticator_credential_id | TEXT | FK to webauthn_credentials.id |
| authenticator_kind | TEXT | Informational: which ecosystem/type signed |
| certificate_json | TEXT | Full UpdateCertificate JSON after completion |
| created_at | TEXT NOT NULL | ISO 8601 |
