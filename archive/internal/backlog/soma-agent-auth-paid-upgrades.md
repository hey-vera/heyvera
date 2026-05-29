# Soma Agent Auth — Paid Upgrades (deferred)

Hardware and paid services that harden the Soma agent-auth / SSH-CA stack beyond the free v0. Each item lists the v0 substitute so we can ship without it, plus what you actually gain by paying.

Parent project: Soma-heart–gated SSH-CA + agent delegation (initial build uses only free tooling — passkeys, WebAuthn, web push, software-backed CA key).

---

## YubiHSM2 — hardware root of trust for the heart CA key

- **Cost:** ~$650 one-time (plus import/tax if not US)
- **v0 substitute:** CA private key stored in an encrypted file on the VPS (`chmod 600`, AES-256 with a passphrase kept out of env, loaded into heart process memory only, zeroed on shutdown).
- **What you gain:** Non-extractable key. Even full VPS root compromise cannot exfiltrate the signing key — attacker can only ask the HSM to sign things while they're in, and the moment you detect compromise you yank the HSM.
- **When to upgrade:** As soon as the system holds credentials that matter more than the cost of the HSM. For a solo dev's VPS that's probably "first real external user" or "first production deploy of a paying customer".
- **Alternative:** Cloud HSM (AWS CloudHSM, GCP KMS with HSM backing) — no hardware to ship, but adds a cloud provider to the trust boundary. Extremist-security framing prefers physical.

---

## Hardware security keys (Yubikey 5C NFC × 2)

- **Cost:** ~$100 for two (one primary, one backup in a safe)
- **v0 substitute:** Platform passkeys (Touch ID on Mac, Face ID on iPhone, Windows Hello, Android biometric). All support WebAuthn with the `uv` (user verification) flag, which is the cryptographic proof we actually need. For tier 3 ("two-factor hardware"), v0 uses "two different platform passkeys from two different devices" — e.g. laptop Touch ID + phone Face ID, both required.
- **What you gain:** A factor that isn't bound to a single device OS or vendor. Yubikey attestation is verifiable — you can cryptographically prove the signature came from a genuine hardware key, not a software emulation. Platform passkeys can't always give you that.
- **When to upgrade:** When you want to distinguish "someone stole my phone and defeated Face ID" from "someone physically stole my Yubikey" in the threat model. Also needed if you want to demo the system without being tied to Apple's ecosystem.

---

## Apple Developer Program (for native APNs push)

- **Cost:** $99/year
- **v0 substitute:** Web Push API. Works on iOS Safari 16.4+, all Android Chrome, all desktop browsers. No app store, no developer account. Same delivery characteristics for interactive prompts.
- **What you gain:** A real native iOS app for approvals. Richer notification UI, background actions, better reliability on iOS devices that aggressively kill browser sessions.
- **When to upgrade:** If web push reliability becomes a problem on iOS (Apple has been known to throttle web push in background) or if you want a branded Soma approvals app for customers.

---

## Twilio / SMS fallback channel

- **Cost:** ~$0.008 per SMS, ~$1/month phone number
- **v0 substitute:** Email with magic link as the fallback when web push fails. Totally free, ~30 seconds slower, but works everywhere.
- **What you gain:** SMS is the most reliable out-of-band channel on earth. If push and email both fail, SMS still gets through.
- **When to upgrade:** If step-up delivery failures start causing real pain. Probably not v0 or v1.

---

## Optional: multi-region heart replicas

- **Cost:** Second VPS (~$6-12/month on DO/Hetzner)
- **v0 substitute:** Single heart on guardian-vps + paper break-glass cert for when it's down.
- **What you gain:** Heart availability stops being a single point of failure. Approvals and cert issuance survive a VPS crash.
- **When to upgrade:** When downtime on the heart starts blocking your own workflow, or when you have external users who can't tolerate outage windows.

---

## Not a dependency, but related: external security audit

- **Cost:** $5-30k depending on scope
- **What you gain:** Third-party review of the CA key handling, ForceCommand wrapper, delegation cert format, and step-up flow before anyone bets real money on it.
- **When to do it:** Before onboarding any external customer to the agent-auth product. Not needed for internal dogfooding.
