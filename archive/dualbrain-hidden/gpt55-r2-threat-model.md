I’ll verify current vendor docs and recent CVE/advisory data first, then turn it into an implementation battle plan with concrete scoring, controls, and playbooks.
As of May 19, 2026: vendors do not publish exact bot classifiers. OpenAI publicly says it uses automated systems, classifiers, hash matching, blocklists and human review; Anthropic documents rate limits and bans scaled abuse/account evasion. So the concrete design below is an implementation-grade inference, not a claim about their proprietary models. Sources: OpenAI usage/content moderation docs, Anthropic rate-limit/agent policy docs, Stripe Radar docs, Docker/gVisor/Firecracker/Kata docs, RustSec/cargo-vet docs, CVE data linked inline.

**1. Bot Detection**
Algorithm: compute `bot_probability` per account/session every request and keep 5-minute, 1-hour, 24-hour aggregates.

```text
score = sigmoid(
  -3.0
  + 1.25*cadence_regularity
  + 1.10*24h_utilization
  + 0.95*parallel_session_count
  + 0.85*tool_call_density
  + 0.80*prompt_reuse_hash_rate
  + 0.75*ws_reconnect_automation
  + 0.70*device_ip_churn
  + 0.65*missing_human_ui_signals
  + 0.55*output_token_harvest_ratio
  + 0.50*payment_risk
)
```

Signals:
`cadence_regularity`: low inter-message entropy, e.g. CV < 0.15 over 30 messages.  
`24h_utilization`: active minutes/day and tokens/day vs normal human plan percentile.  
`parallel_session_count`: simultaneous tabs/devices/workers generating requests.  
`tool_call_density`: tool calls/message and tool-call chains without reading/UI pauses.  
`prompt_reuse_hash_rate`: MinHash/SimHash repeat prompts across accounts.  
`ws_reconnect_automation`: reconnect within fixed intervals, no jitter.  
`device_ip_churn`: many ASNs, datacenters, proxies, device fingerprints.  
`missing_human_ui_signals`: no typing cadence, no focus/blur, no scroll/read delay.  
`output_token_harvest_ratio`: high output tokens, low interactive back-and-forth.

Actions:
`<0.35` allow. `0.35-0.65` soft friction: slower queue, CAPTCHA/passkey reauth, lower concurrency. `0.65-0.85` human-tier throttle: disable parallel workers, require payment-method/phone/passkey recheck. `>0.85` suspend automation, offer x402/API tier.

Attack table:

| Attack | L | I | Detection | Prevention | Response |
|---|---:|---:|---|---|---|
| Script uses $7.99 human tier as API | 5 | 4 | High cadence, 24h use, no UI signals | Human plan concurrency cap, bot score, per-account token ceilings | Throttle, notify, migrate to x402/API |
| Account farm rotates humans/proxies | 4 | 4 | Shared prompt hashes, payment/device graph | Stripe Radar, phone/passkey, graph limits | Freeze cluster, refund/ban abuse |
| Slow bot mimics human | 3 | 3 | Long-horizon entropy, task graph similarity | Progressive trust, reputation weighted quotas | Require re-verification, mark account risk |

Sources: OpenAI automated/manual monitoring and classifiers/hash/blocklists, OpenAI rate-limit guidance, Anthropic rate limits and scaled-abuse policy, OWASP bot management guidance.  
https://openai.com/transparency-and-content-moderation/  
https://platform.openai.com/docs/guides/rate-limits/retrying-with-exponential-backoff%20.eot  
https://docs.anthropic.com/en/api/rate-limits  
https://support.anthropic.com/en/articles/12005017-using-agents-according-to-our-usage-policy  
https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html

**2. Sybil Prevention**
Stripe Radar signals: use Checkout/Elements/mobile SDKs so Stripe collects high-signal device, IP, and user-activity data; Radar risk scores initial subscription payments and rules can evaluate later payments. Do not build a homemade card-risk model first. Source: https://docs.stripe.com/radar/integration and https://docs.stripe.com/radar/risk-evaluation

Phone verification: Twilio Verify US pricing is roughly `$0.05` per successful SMS/voice verification, with WhatsApp also listed at `$0.05` plus template fees. Treat SMS as cost/Sybil friction, not strong auth; NIST treats SMS/PSTN as restricted/authenticator-risky. Sources: https://www.twilio.com/en-us/verify/pricing and https://pages.nist.gov/800-63-4/sp800-63b.html

GDPR/device fingerprinting: use data minimization. Prefer server-side passive signals first: IP ASN, TLS/client hints, auth device id, payment fingerprint, passkey credential id. If storing/accessing non-essential browser data, run a DPIA, disclose fraud-prevention purpose, retain short TTL, hash/salt fingerprints, and get consent where ePrivacy requires it. CNIL recognizes legitimate interest can apply if necessary and proportionate, including fraud-prevention contexts. Source: https://www.cnil.fr/en/relying-legal-basis-legitimate-interests-develop-ai-system

Agents:
Default: no free autonomous agent tier. Agent identity requires one of:
`human_vouch`: verified paid human sponsors the DID with revocable delegation.  
`stake`: USDC bond, e.g. `$25` minimum for low-risk API, `$250+` for tool execution, dynamic by requested spend cap.  
`history`: payment/receipt history unlocks lower collateral.

| Attack | L | I | Detection | Prevention | Response |
|---|---:|---:|---|---|---|
| Trial/referral farm | 5 | 3 | Shared cards/devices/IPs, rapid referrals | No cash-equivalent trial, Radar, delayed rewards | Void rewards, block graph |
| DID Sybil swarm | 5 | 4 | No payment history, shared vouches | Stake/vouch required, spend caps | Slash/revoke delegations |
| Stolen card subscription | 4 | 4 | Radar elevated risk, disputes | 3DS on risk, no instant high quotas | Suspend, preserve evidence, refund/report |

**3. Container Security**
Current threat: containers share the host kernel. Recent escape class remains real: `CVE-2024-21626` runc fd leak allowed host filesystem access; 2025 runc flaws `CVE-2025-31133`, `CVE-2025-52565`, `CVE-2025-52881` were reported as enabling host info disclosure/DoS/escape under malicious mount/image conditions. Sources: https://cve.mitre.org/cgi-bin/cvename.cgi?name=2024-21626 and https://inspektor-gadget.io/blog/2025/12/detect-and-mitigate-runc-container-escape-vuln/

Recommendation:
Hostile coding agents: Firecracker microVMs with jailer.  
Medium-risk plugin/tools: gVisor `runsc`.  
Kubernetes OCI compatibility: Kata Containers.  
Plain Docker/runc only for trusted internal services.

Sources: Firecracker uses lightweight VMs and jailer for production isolation; gVisor provides an OCI runtime interposing a userspace kernel; Kata adds VM isolation.  
https://github.com/firecracker-microvm/firecracker  
https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md  
https://github.com/google/gvisor  
https://katacontainers.io/?lang=en

Seccomp/caps baseline:
`no_new_privileges=true`, rootless/user namespace, read-only rootfs, drop all caps, add only needed caps. Block/avoid `mount`, `ptrace`, `bpf`, `perf_event_open`, `clone/unshare/setns` namespace creation, `keyctl/add_key`, module loading, `swapon`, raw sockets. Docker default seccomp already blocks many of these, but hostile agents need a tighter profile. Source: https://docs.docker.com/engine/security/seccomp/

Network egress:
Default deny. Agent gets brokered egress only: DNS allowlist, HTTPS CONNECT to approved domains, per-job budget, no RFC1918/link-local/metadata IPs, no SMTP, no raw sockets, no direct wallet/KMS endpoints. Log domain, IP, bytes, job id, Soma delegation id.

| Attack | L | I | Detection | Prevention | Response |
|---|---:|---:|---|---|---|
| Container escape | 3 | 5 | Falco/eBPF syscall anomalies, mount/proc writes | Firecracker/gVisor, patched runc, rootless | Kill host pool, rotate node creds |
| Data exfil via egress | 4 | 5 | Unusual domains/bytes/DNS | Egress broker, deny private IPs | Revoke job/session, preserve logs |
| Crypto miner/resource abuse | 4 | 3 | CPU/GPU/network quotas | cgroups, wall-clock budget | Terminate, slash stake |

**4. Key Management Production**
Use managed KMS/HSM for root and wrapping keys. For a small team with real money, choose AWS KMS first for operational maturity; use CloudHSM/custom key store or a dedicated signing service if Ed25519 private keys must be non-exportable. Vault Transit is useful for app-level envelope encryption and audit, but self-hosted Vault becomes critical infrastructure; do not make it your first root of trust unless you can operate HA Vault well. Sources: AWS KMS hierarchy/envelope encryption and Vault Transit rotation docs.  
https://docs.aws.amazon.com/kms/latest/cryptographic-details/key-hierarchy.html  
https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html  
https://developer.hashicorp.com/vault/docs/secrets/transit

Hierarchy:
`Root KEK`: HSM/KMS, non-exportable, rotates yearly or on compromise.  
`Service KEK`: per service/surface, encrypted by root.  
`User KEK`: per user/agent, encrypted by service KEK.  
`Session/action key`: short-lived Ed25519/X25519 keys, caveat-bound, TTL minutes-hours.  
`Data keys`: envelope encryption per object/event; never reuse for broad domains.

Rotation ceremony:
1. Create new key version in KMS/HSM.
2. Dual-publish public key/JWK/DID metadata with `not_before`.
3. Sign new delegations with new key; accept old+new during overlap.
4. Rewrap service/user KEKs asynchronously.
5. Shorten old delegation TTLs.
6. Stop issuing old signatures.
7. Revoke old key version after max TTL plus settlement window.
8. Produce audit packet: operator approvals, timestamps, affected key ids, test signatures.

Social recovery:
Use 5 guardians, threshold 3-of-5 for normal accounts; 5-of-7 for treasury/admin. Do not split the live signing key. Split a recovery seed or recovery authorization secret with Shamir Secret Sharing; guardians approve installing a new user key after a 24-72h timelock and user notifications. Social recovery model reference: https://eco.com/support/en/articles/11011424-what-is-social-recovery

| Attack | L | I | Detection | Prevention | Response |
|---|---:|---:|---|---|---|
| Root/service key compromise | 2 | 5 | KMS anomalous use, signature spikes | HSM, least-privilege IAM, dual control | Revoke, rotate, re-sign, notify |
| Session key theft | 4 | 3 | Geo/device mismatch, replay attempts | Short TTL, caveats, mTLS | Revoke session/delegation |
| Guardian collusion | 2 | 5 | Recovery request anomaly | Threshold + timelock + alerts | Freeze recovery, rotate guardians |

**5. Incident Playbooks**
Key compromise:
Declare SEV-1, freeze signing/delegation issuance, revoke affected key ids, rotate KMS/service/user/session keys, invalidate active delegations, rewrap data keys if exposed, publish signed incident root, notify affected users/regulators if required, postmortem.

x402 replay:
Detect duplicate nonce/payment authorization/resource hash, mismatched ETag/content hash, same payment used across resources. Quarantine resource, reject duplicate, invalidate facilitator settlement, add nonce to denylist, inspect logs for binding bug. x402 relies on signed authorizations/nonces and EIP-3009-style replay protection, but server-side binding is still required. Sources: https://docs.cdp.coinbase.com/x402/docs/client-server-model and https://docfork.com/coinbase/x402 and recent attack paper https://arxiv.org/abs/2605.11781

Data leak:
Freeze affected worker pool, snapshot logs/images, identify data class, rotate secrets touched by workload, notify under legal clock, purge leaked artifacts from observability, add detection rule.

Delegation abuse:
Detect spend/action anomaly, counterparty complaints, caveat violation attempts. Cut by revoking delegation chain root, lowering agent reputation, slashing stake if terms cover it, requiring human re-vouch.

**6. Economic Security**
Referral abuse:
Reward only after first paid month clears plus no dispute for 30 days. No withdrawable reward for self-referrals. Cap rewards by verified human/payment instrument. Cluster graph fraud.

Trial cost model:
If average human cost is `$0.15/month`, a bot can still make cost unbounded through frontier/tool execution. Trial must exclude expensive tools/frontier by default. Give trial fixed daily compute budget, no parallel agents, no cash payout/referral credit until payment clears.

x402 floor:
If Base gas can range from sub-cent to higher during congestion and you cite `$0.06`, price floor should be `max($0.10, 3*settlement_cost + provider_cost + risk_margin)` for direct settlement. For micropayments under `$0.10`, batch or prepaid balance. Do not sell `$0.01` calls if settlement is `$0.06`.

Stake/slash:
Low-risk read API: `$25` bond.  
Write/tool execution: `$250-$1,000`.  
Marketplace/high-spend agents: `max($500, 2x daily spend cap)`.  
Slash for replay attempts, fraud, spam, policy-violating tool use, nonpayment/chargeback, proven exfiltration.

**7. DDoS Layered Defense**
Cloudflare:
Use Pro minimum, Business/Enterprise once real money volume exists. Enable WAF managed rules, Bot Fight/Bot Management if budget, Advanced Rate Limiting for `/auth`, `/api/*`, `/x402/*`, `/ws`, challenge suspicious human traffic, block direct-to-origin except Cloudflare IPs. Cloudflare documents always-on DDoS, request metadata-based mitigation, and rate limiting at edge.  
https://developers.cloudflare.com/ddos-protection/about/how-ddos-protection-works/  
https://developers.cloudflare.com/waf/rate-limiting-rules/  
https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/

Rust/Axum:
`tower-governor` works with Axum/Tower. Source: https://docs.rs/tower_governor/latest/tower_governor/index.html

WebSocket:
Limit unauthenticated connects per IP/ASN. Require auth before upgrade for private channels. Cap connections per user, per DID, per payment method. Heartbeat timeout 30s, max idle 60s, max session 6h, backpressure queue caps, message size caps, per-connection token bucket.

Smart DDoS with valid x402:
Valid payment does not imply valid work. Add prompt-cost estimator before model/tool execution, require prepay for estimated worst-case, reject low-entropy garbage, per-agent quality/reputation throttles, settlement batching, and provider circuit breakers.

| Attack | L | I | Detection | Prevention | Response |
|---|---:|---:|---|---|---|
| L7 flood | 4 | 4 | Edge analytics, 429 spikes | Cloudflare WAF/rate limits | Under-attack mode, tighten rules |
| WS exhaustion | 4 | 4 | Conn count, idle sockets | Auth-before-upgrade, caps | Drop idle/risky cohorts |
| Paid garbage prompts | 3 | 4 | Low value/high cost ratio | Prepay estimate, reputation | Raise floor, throttle agent |

**8. Supply Chain**
Use all three:
`cargo-audit`: known RustSec CVEs against `Cargo.lock`.  
`cargo-deny`: licenses, bans, duplicate versions, source allowlists, advisories.  
`cargo-vet`: human-reviewed trust/audit records for dependency versions.  
RustSec explicitly positions `cargo-audit` for vulnerabilities and `cargo-deny` for advisories/licenses/sources; cargo-vet stores audit metadata in `supply-chain/`. Sources: https://rustsec.org/ and https://mozilla.github.io/cargo-vet/how-it-works.html

Recent Rust ecosystem pattern: malicious crates on crates.io impersonating legitimate packages and stealing Ethereum/Solana keys were disclosed in September 2025. That matters directly to HeyVera because wallet/key material is in scope. Source: https://blog.rust-lang.org/2025/09/24/crates.io-malicious-crates-fasterlog-and-asyncprintln/

Policy:
No new crate without owner approval if it touches crypto, auth, HTTP, parsing, proc macros, build scripts, or filesystem/network. Pin `Cargo.lock`. Deny git dependencies except approved SHAs. For proc macros/build.rs/native deps, require manual review. Run `cargo audit`, `cargo deny check`, `cargo vet`, SBOM, and reproducible release build in CI. Use minimal features.

| Attack | L | I | Detection | Prevention | Response |
|---|---:|---:|---|---|---|
| Malicious crate/typosquat | 4 | 5 | Diff review, network/fs effects | cargo-vet, allowlist, no casual deps | Yank dep, rotate secrets |
| Vulnerable transitive dep | 4 | 4 | cargo-audit/deny CI | lockfile, Dependabot | Patch/release advisory |
| Build script exfiltrates secrets | 3 | 5 | CI egress logs | sandboxed builds, no secrets in build | Rotate CI/dev secrets |

**Priority Order**
1. Build the bot score + human/API tier separation before launch.
2. Put hostile code in Firecracker or gVisor, not Docker-only.
3. Implement KMS-backed key hierarchy and delegation revocation before real money.
4. Add x402 nonce/resource binding logs from day one.
5. Enforce cargo-audit/deny/vet in CI before adding more crates.
