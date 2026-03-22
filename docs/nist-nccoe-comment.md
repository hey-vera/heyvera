# Public Comment: NIST NCCoE AI Agent Identity & Access Management

**To:** AI-Identity@nist.gov
**Re:** Concept Paper — Accelerating the Adoption of Software and AI Agent Identity and Authorization
**From:** Josh Mclain, ClawNet / AID Protocol
**Date:** March 22, 2026
**Affiliation:** ClawNet (claw-net.org) — production AI agent orchestration platform; AID Protocol — open trust scoring standard for autonomous agents

---

## 1. Summary

We support the NCCoE's initiative to standardize AI agent identity and access management. The concept paper correctly identifies OAuth 2.0, OpenID Connect, SPIFFE/SPIRE, and SCIM as foundational technologies for agent credentialing and authorization.

We submit this comment to highlight a gap the current framework does not address: **agent-to-agent trust in zero-prior-relationship environments**, where no OAuth issuer, no OIDC provider, and no SPIFFE trust domain exists between the interacting parties.

We propose that NIST consider **self-certifying cryptographic identities with behavioral trust scoring** as a complementary layer — not a replacement — to the OAuth/OIDC stack. This approach addresses the autonomous agent-to-agent commerce scenario that falls outside the human-delegated authorization model the concept paper focuses on.

## 2. The Gap: Agent-to-Agent Trust Without Prior Relationship

The concept paper's architecture assumes a trust chain originating from a human principal: a user authenticates via OIDC, delegates scoped permissions to an agent via OAuth 2.0 access tokens, and the receiving service validates the token against a known authorization server.

This model works well for **human-to-agent** and **agent-to-known-service** interactions. It does not address the emerging pattern of **autonomous agent-to-agent transactions** where:

- **No shared authorization server exists.** Agent A (operated by Company X) discovers Agent B (operated by Company Y) at runtime. Neither has pre-registered with the other's OAuth provider.
- **No human is in the loop.** The agent is executing autonomously within a delegated budget. It must evaluate whether a newly discovered counterparty is trustworthy before transacting.
- **Identity must be verifiable offline.** In latency-sensitive or high-volume agent interactions (micropayments, real-time data queries), requiring a round-trip to an external OIDC provider for every interaction is impractical.

OAuth answers *"who authorized this agent?"* It does not answer *"is this agent worth doing business with?"* Both questions must be answered for safe autonomous commerce.

## 3. Proposed Complementary Approach: Self-Certifying DIDs with Behavioral Trust

We have deployed a production system (AID — Agent Identity Document) that addresses this gap using W3C-standard building blocks:

**Identity layer — W3C `did:key` method (Ed25519):**
- Each agent holds an Ed25519 keypair. The public key *is* the identifier: `did:key:z6Mk...` (W3C DID Core v1.1, `did:key` method specification).
- Identity is self-certifying: the DID encodes the public key directly. No registry lookup required. Verification is pure cryptography — a single Ed25519 signature check (~0.1ms).
- Compatible with SPIFFE's workload identity model: an Ed25519-based SVID can be mapped bidirectionally to a `did:key` identifier, enabling agents operating within SPIFFE trust domains to carry portable identity into cross-domain interactions.

**Trust layer — deterministic behavioral scoring:**
- Every agent transaction produces a signed attestation (input hash, output hash, duration, outcome status, HMAC signature, hash-chain link to previous attestation).
- Trust scores are computed from attestation history using a published, deterministic formula: `score = successRate(40%) + chainCoverage(25%) + volume(20%) + manifestAdherence(15%)`.
- Scores are anchored in Merkle trees, enabling offline verification: given a Merkle root (publishable on-chain or via any transparency log), any third party can verify an individual attestation's inclusion without querying the scoring oracle.
- The scoring algorithm is open-source (MIT license) so that any party can independently recompute and verify scores.

**How this complements OAuth/OIDC:**

| Scenario | OAuth/OIDC | DID + Trust Score |
|----------|-----------|-------------------|
| Human delegates to agent | Access token with scoped permissions | N/A — OAuth handles this |
| Agent calls known API | Bearer token validated against issuer | N/A — OAuth handles this |
| Agent discovers unknown agent | **No mechanism** — no shared issuer | DID proves identity; trust score indicates reliability |
| Agent evaluates counterparty quality | **No mechanism** — tokens prove authorization, not track record | Attestation history + Merkle proof provides verifiable performance data |
| Offline/low-latency verification | Requires token introspection endpoint | Ed25519 signature check — pure math, no network call |

## 4. Production Evidence

This is not a theoretical proposal. The following capabilities are deployed in production on ClawNet's agent orchestration platform:

- **Agent registration with Ed25519 `did:key` identifiers** — full identity lifecycle including register, resolve, rotate key, freeze, delete, verify, export, and trust lookup
- **Signed attestations on every transaction** — HMAC-SHA384 with hash chaining for tamper detection, sequence numbers for replay protection
- **Merkle-anchored trust snapshots** — rebuilt every 4 hours, enabling offline proof verification
- **Offline identity verification** — pure cryptographic verification with zero database or network calls
- **Granular policy engine** — per-transaction caps, skill whitelists, provider whitelists, time-window constraints on delegated keys
- **Public trust API** — any party can query an agent's trust verdict without authentication, rate-limited to prevent abuse
- **Open-source scoring library** — deterministic trust computation, MIT license, independently verifiable
- **Crypto-agile architecture** — SHA-384 trust-layer hashing, algorithm-versioned signatures, designed for NIST post-quantum migration (ML-DSA, FIPS 204) without protocol-level changes

The system has been hardened against 46 documented attack vectors including Sybil reputation gaming, bust-out fraud, permit signature phishing, feedback cartel collusion, and trust oscillation farming.

## 5. Recommendations

We respectfully recommend the NCCoE consider the following additions to the framework:

1. **Acknowledge the agent-to-agent trust gap.** The current concept paper focuses on human-delegated authorization. We recommend a section addressing cross-domain agent-to-agent discovery and trust evaluation, where no pre-existing OAuth relationship exists.

2. **Include W3C DIDs as a complementary identity mechanism.** `did:key` (Ed25519) provides self-certifying, offline-verifiable identity that works alongside OAuth tokens. The DIF Trusted AI Agents Working Group (TAAWG) is actively developing interoperability standards for DID-based agent identity within MCP and A2A protocol contexts.

3. **Define behavioral trust scoring as a recommended capability.** Just as NIST SP 800-63 defines identity assurance levels, a parallel framework for agent *behavioral* assurance — based on verifiable transaction history rather than credential strength — would address the quality dimension that authorization alone cannot capture.

4. **Require transparency mechanisms for trust computation.** Any trust scoring system used in agent commerce should publish its formula, accept independent verification, and provide cryptographic proofs (e.g., Merkle inclusion proofs) that enable offline audit. This prevents trust oracles from becoming opaque gatekeepers.

5. **Consider SPIFFE/DID interoperability.** Agents operating within enterprise SPIFFE trust domains will increasingly need to interact with agents in other domains. A standardized mapping between SPIFFE SVIDs and W3C DIDs would enable seamless cross-domain trust without requiring a shared SPIFFE trust root.

---

**Contact:** Josh Mclain — josh@claw-net.org | https://claw-net.org | https://github.com/1xmint

**References:**
- W3C DID Core v1.1: https://www.w3.org/TR/did-core/
- W3C `did:key` Method: https://w3c-ccg.github.io/did-method-key/
- DIF Trusted AI Agents Working Group: https://identity.foundation/working-groups/trusted-agents.html
- SPIFFE Specification: https://spiffe.io/docs/latest/spiffe-about/overview/
- NIST SP 800-63-4: Digital Identity Guidelines
- NIST SP 800-207: Zero Trust Architecture
