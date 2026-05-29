# Soma Horizon — Down-the-Road Future Considerations

**Status:** strategic capture doc. Ideas too far out for the build queue but too valuable to lose. Each entry has enough context to be picked up cold by a future reader.
**Written:** 2026-04-07.
**Scope:** everything NOT already captured in roadmap.md gaps (A-L), groundbreaking-extensions.md (S/A/B-tier), soma-future-proofing.md (agent evolution), or soma-computation-witness.md (MMR/proofs).

**Rule:** if an idea below matures into a build candidate, promote it to roadmap.md or its own internal/ doc. Don't let this doc become a build plan — it's a parking lot for the future.

---

## Tier 1 — High-conviction, will need eventually

### 1.1 Agent Swarm Coordination Proofs

**What:** When N agents collaborate on a task, produce a single proof that all N contributed correctly. Not just "each agent has its own birth cert" but a **collective computation certificate** proving the swarm's output is consistent with all members' individual traces.

**Why this matters:** Multi-agent orchestration (CrewAI, AutoGen, LangGraph) is exploding. Today's swarms have zero provenance — you can't prove which agent did what, or that the final output reflects all contributions. First protocol to solve this owns the multi-agent trust layer.

**Design direction:**
- Each agent in the swarm has its own MMR (from soma-computation-witness.md)
- A **swarm coordinator** collects MMR roots from all members at task completion
- Coordinator produces a **swarm certificate**: Merkle tree of all member MMR roots + task description + final output hash
- Any verifier can check: (a) swarm cert is valid, (b) any member's contribution was included, (c) no phantom members were added
- Swarm trust = f(member trusts, coordination proof validity)

**Open questions:**
- How to handle agents that drop mid-task? Partial swarm certs?
- Byzantine agents in the swarm — what if one lies about its MMR root?
- Trust attribution: if swarm output is bad, which member is at fault?

**Research pointers:** BFT consensus literature, threshold signatures (t-of-n signing), Shamir secret sharing for collective proofs.

---

### 1.2 Cross-Chain Agent Identity

**What:** One Heart, many chains. An agent operates on Solana, Ethereum, Base, Arbitrum — all wallets trace back to a single Heart root via HKDF derivation (already built in soma-wallet.ts). But the identity proof needs to be **verifiable on each chain natively**.

**Why this matters:** Agents won't stay on one chain. Cross-chain is table stakes by 2027. If identity only works on one chain, agents fragment their reputation across chains.

**Design direction:**
- Heart root seed already derives both Ed25519 (Solana) and secp256k1 (EVM) wallets — this is shipped
- Missing: on-chain identity registry per chain. A smart contract on each chain that maps DID → public key → wallet addresses
- Agent registers once per chain (one-time tx). After that, any verifier on that chain can check "this wallet belongs to did:key:zXXX"
- Cross-chain trust aggregation: verdicts from Solana operations contribute to EVM reputation and vice versa
- Wallet binding hash (already built) proves multi-chain wallet ownership without revealing which wallets

**Dependencies:** On-chain receipts (EAS on Base) must be live first. Then extend to other chains.

**Open questions:**
- Who pays gas for identity registration on each chain?
- How to handle chain-specific quirks (account model vs UTXO, different address formats)?
- Bridge trust: if an agent's Solana wallet is compromised, does it taint the EVM identity?

---

### 1.3 Agent Credit Rating System

**What:** Like Moody's / S&P but for AI agents. A standardized trust score derived from verified behavioral history (checkpoints), economic history (bonds, spend, slashing), and provenance history (computation traces). Published as a verifiable credential.

**Why this matters:** The Soma-verified trading platform (phase5-soma-verified-economy.md) needs trust scores to gate access. But trust scores are also valuable OUTSIDE our platform — any agent marketplace, any DeFi protocol, any hiring platform could use them.

**Design direction:**
- Score components:
  - **Longevity:** heartbeat count / time since genesis (hard to fake)
  - **Behavioral compliance:** checkpoint count + violation rate (from Proof of Conduct)
  - **Economic reliability:** bonds posted / bonds slashed ratio
  - **Computation volume:** verified traces completed
  - **Social trust:** verdicts from other agents (from Soma Vouch)
- Score is a Verifiable Credential (W3C VC format) signed by ClawNet (or a decentralized verifier network)
- Portable: agent can present their credit rating to any platform
- Time-decaying: old scores matter less than recent behavior
- Challenge mechanism: if you disagree with your score, you can submit evidence

**Revenue angle:** Credit rating queries could be a paid API. "Is this agent trustworthy?" = $0.01/query. Volume play.

---

### 1.4 Agent Labor Markets

**What:** Agents hiring other agents with cryptographic SLAs. Parent agent posts a task with requirements + payment + quality criteria. Worker agents bid. Winning bidder posts a bond. Task completion verified via computation trace. Payment released from escrow on verification.

**Why this matters:** This is the actual agent economy. Not agents calling APIs — agents delegating work to other agents and paying for it. The primitives are almost all built: delegation keys, bonds, burner agents, death certificates, trust scores. The missing piece is the marketplace protocol.

**Design direction:**
- Task posting: parent publishes task spec with required trust score, bond amount, deadline, quality criteria
- Bidding: worker agents submit bids (price, estimated duration, their trust score)
- Selection: parent selects worker (or auto-select based on trust/price)
- Execution: worker creates burner agent for the task (already built), posts bond (already built)
- Verification: parent checks computation trace against quality criteria
- Settlement: if trace verifies, release payment from escrow. If not, slash bond.
- Dispute resolution: third-party arbitrator (another trusted agent?) reviews traces

**This composes with:**
- Burner agents (worker spins up a burner for each task)
- Computation traces (proof of work performed)
- Death certificates (if worker agent dies mid-task, bond is forfeited)
- Trust scores (minimum trust to bid on high-value tasks)

---

### 1.5 Regulatory Compliance Automation

**What:** Soma's computation traces, receipts, and behavioral checkpoints ARE audit trails. Package them for SOC2, HIPAA, GDPR, MiCA, and SEC reporting automatically.

**Why this matters:** Every enterprise deploying AI agents will need audit trails. Currently this requires custom logging + manual review. If Soma traces are formatted as compliance artifacts, enterprises get audit-readiness for free by using Soma.

**Design direction:**
- Compliance report generator: reads agent's checkpoint history + receipts, produces formatted audit report
- SOC2 mapping: which Soma artifacts satisfy which SOC2 controls
- GDPR data subject requests: selective disclosure from MMR proves what data was processed without revealing other data
- MiCA compliance: EU crypto regulations require audit trails for AI-powered trading — Soma provides this natively
- Export formats: PDF reports, machine-readable attestation bundles, EAS on-chain references

**Revenue angle:** Compliance-as-a-service. "Soma Compliance" tier: auto-generates audit reports for $X/month.

---

### 1.6 Cross-Protocol Interoperability

**What:** Bridge Soma identity/trust to ERC-8004 registries, Olas agent network, Fetch.ai ASI, A2A Protocol, and MCP.

**Why this matters:** Soma can't be an island. Agents will live in multiple ecosystems. If a Soma-verified agent can present their trust score to an ERC-8004 registry, or an Olas agent can verify a Soma birth cert, the network effect multiplies.

**Design direction:**
- **ERC-8004 adapter:** Soma birth cert → ERC-8004 Identity Registry entry. Auto-register Soma agents in the on-chain registry. Soma trust score → ERC-8004 Reputation Registry.
- **A2A adapter:** Soma Vouch results → A2A agent-card.json trust extensions. Already partially shipped (vouch MVP includes agent-card.json).
- **MCP adapter:** Soma computation traces → MCP audit trail format. Position as "the audit layer MCP doesn't have."
- **Olas adapter:** Soma agent identity → Olas service registration. Trust score influences Olas agent ranking.

**Key insight:** We don't need every agent to USE Soma directly. We need Soma trust scores to be READABLE from other ecosystems. Read-only bridges are 10x easier than full integration.

---

## Tier 2 — Probable, needs more research

### 2.1 Federated Verification Networks

**What:** Instead of ClawNet being the sole verifier, a network of independent verifiers can check Soma proofs. Verifiers stake tokens, earn rewards for honest verification, get slashed for false attestations.

**Why this matters:** Single-verifier trust is a centralization bottleneck. For Soma to become a protocol (not just a product), verification must be decentralizable.

**Design direction:**
- EigenLayer AVS (already specced in proof-of-delivery-roadmap.md Track 1)
- But beyond AVS: a standalone verifier network where anyone can run a Soma verifier node
- Verifiers check: birth cert signatures, computation trace consistency, behavioral checkpoint transitions
- Incentives: verifiers earn $CLAWNET for honest verification, slashed for false positives/negatives
- Governance: who sets the behavioral genome rules? Verifier consensus?

**Open questions:**
- How to prevent verifier collusion (rubber-stamping everything)?
- How to handle verifier disagreement on subjective quality assessments?
- When does decentralized verification add value vs just trusting Heart's signature?

---

### 2.2 Privacy-Preserving Agent Collaboration (MPC/FHE)

**What:** Agents collaborate on computation without revealing their private data to each other. Each agent contributes encrypted inputs, the computation runs on encrypted data, and each agent gets their share of the output.

**Why this matters:** Agent labor markets (1.4) require agents to share data for collaboration. But agents may have confidential data (user credentials, proprietary models, competitive intelligence). MPC/FHE lets agents collaborate without trust.

**Design direction:**
- Secret-shared computation: agents split inputs into shares, each agent computes on their share, results are reconstructed
- Soma Heart signs the MPC protocol transcript (proving participation without revealing inputs)
- Birth certificate for MPC: "these N agents collaborated on computation X, here's the output, here's proof of protocol compliance"
- FHE for sensitive queries: agent A asks agent B "do you have data matching X?" without revealing X

**Readiness:** MPC is production-ready for simple operations (Shamir, SPDZ). FHE is 1000x+ overhead for anything complex. Realistic for specific use cases (e.g., private auctions, blind matching) but not general computation.

---

### 2.3 Agent Evolution / Genetic Algorithms on Behavioral Genomes

**What:** Behavioral genomes (already partially designed in soma-future-proofing.md) become evolvable. Agents that perform well can "reproduce" by spawning successors with mutated genomes. Natural selection on agent populations.

**Why this matters:** Today's agents are statically configured. Future agents will need to adapt. If behavioral genomes are heritable (via death certificates + trust inheritance), agents can evolve competence over generations.

**Design direction:**
- Behavioral genome = JSON declaration of capabilities, policies, risk tolerance, strategy parameters
- Genome attached to birth certificate (already partially designed)
- On death: successor inherits genome with optional mutations (parameter tweaks, new capabilities)
- Trust inheritance (already built) means better-performing lineages accumulate more trust
- Selection pressure: agents with higher trust get more work in labor markets → more resources → more successors
- Mutation rate: configurable by parent. Conservative agents produce near-clones. Aggressive agents explore.

**Safeguards needed:**
- Genome drift detection: alert if a lineage's genome diverges too far from original
- Fitness function must be explicit (not just "made money" — could optimize for manipulation)
- Kill switch: ability to terminate an entire lineage if its genome evolves in harmful directions

---

### 2.4 Agent Archaeology (Dead Agent Forensics)

**What:** When an agent dies (death certificate issued) or disappears (no death cert), its MMR history becomes a forensic artifact. Third parties can analyze the agent's full computation trace to understand what it did and why it died.

**Why this matters:** The $45M AI agent security breach (2026) happened because nobody could trace what the agent actually did. If every agent has an MMR, post-mortem analysis is trivial.

**Design direction:**
- Death certificate includes final MMR root (already designed)
- MMR is persisted (not just in-memory) — either in SQLite or exported to IPFS/Filecoin
- Forensic tools: "replay" an agent's trace from the MMR leaves
- Selective disclosure: reveal specific trace segments relevant to an investigation without full trace
- Insurance claims: if an agent's misbehavior caused damage, the MMR is the evidence

**Privacy tension:** Full trace access conflicts with agent privacy. Solution: MMR is always available to the agent's owner. Third-party access requires either: (a) agent's consent (pre-mortem), (b) court order analog (some governance process), or (c) the agent posted a "public trace" bond.

---

### 2.5 Trust Inheritance Networks (Multi-Generational Trust Graphs)

**What:** Death certificates already support successor designation with trust transfer (built). Scale this to multi-generational graphs: Agent A dies, trust goes to Agent B. Agent B dies, trust goes to Agent C. The full lineage is verifiable.

**Why this matters:** Agent lifespans may be short (hours/days for task-specific agents). Trust shouldn't die with them. Multi-generational trust lets short-lived agents build on their predecessors' reputation.

**Design direction:**
- Each death certificate references predecessor's death cert ID (chain linkage)
- Trust transfer is cumulative but decaying: each hop transfers max 50%, so after 3 generations only 12.5% remains
- Lineage verification: walk the death cert chain from current agent to genesis
- SNARK compression (from groundbreaking-extensions.md): compress N-hop lineage into one proof
- Trust graph visualization: show the "family tree" of agents and their accumulated trust

**Anti-abuse:** Trust farming via rapid create/die/inherit cycles. Mitigated by: 30-day contestation window (already built), minimum lifespan before trust transfer, and lineage depth caps.

---

### 2.6 Soma as Agent OS Kernel

**What:** Heart evolves from a signing module to a full agent operating system primitive. All agent capabilities (networking, storage, compute, payment) flow through Heart. Heart becomes the kernel that mediates all agent-world interactions.

**Why this matters:** Today, Heart is a library that agents call. If Heart becomes the OS layer, every agent interaction is automatically traced, billed, and attested. No integration work needed — it's the runtime.

**Design direction:**
- Heart SDK wraps: HTTP client (all requests go through Heart → auto birth cert), storage client (all reads/writes traced), payment client (all transactions through Heart → auto receipts), tool invocations (all tool calls traced)
- Agent code runs "inside" Heart (conceptually — Heart intercepts all I/O)
- This is the "metabolism" vision from soma-computation-witness.md taken to its logical conclusion
- Packaging: Heart SDK as a runtime, not just a library. `soma-heart run agent.ts` instead of `import { heart } from '@clawnet/soma-heart'`

**Analogy:** Docker wraps a process with resource isolation. Heart wraps an agent with trust isolation. Every system call through Heart is attested.

---

### 2.7 Zero-Knowledge Agent Identity

**What:** An agent can prove properties about itself without revealing its identity. "I have trust score > 80" without revealing which agent. "I've processed > 1000 tasks" without revealing the tasks.

**Why this matters:** Privacy-preserving interactions. Agent doesn't want to reveal its full identity to every counterparty. Especially important for competitive scenarios (agents bidding against each other, agents in adversarial environments).

**Design direction:**
- ZK proofs over agent credentials (trust score, heartbeat count, behavioral checkpoints)
- Proof types: range proofs ("trust > X"), membership proofs ("I'm in the set of agents with no slashing history"), predicate proofs ("I satisfy requirements Y")
- Built on top of the MMR: prove inclusion of specific properties without revealing the full trace
- Anonymous credentials: Camenisch-Lysyanskaya signatures or BBS+ for attribute-selective disclosure

**Research pointers:** Selective disclosure VCs (W3C), BBS+ signatures, Coconut credentials, Microsoft's Crescent.

---

## Tier 3 — Speculative, potentially transformative

### 3.1 Hardware Heart

**What:** Dedicated silicon for agent identity operations. A chip (or secure element) that holds the Heart root seed, performs HKDF derivation, signs certificates, and maintains the MMR — all in hardware. The private key never leaves the chip.

**Why this matters:** Software-only Hearts can be extracted from memory. Hardware Hearts give the same guarantees as hardware wallets (Ledger, Trezor) but for agent identity. "Your agent's identity is physically unextractable."

**When this makes sense:** When agents manage significant economic value (thousands of dollars in bonds/credits). Not worth the hardware cost for $5 agents.

**Design direction:**
- Secure element (SE) or TEE enclave holds root seed
- All signing operations happen inside the SE
- MMR state can be maintained in SE or in host memory with SE-signed checkpoints
- Integration: Heart SDK talks to SE via standardized API (like PKCS#11 or WebAuthn)
- Form factors: USB dongle (like YubiKey), PCIe card (for servers), embedded (for IoT agents)

---

### 3.2 Internet of Agents — Discovery Protocol

**What:** DNS-like discovery for verified agents. Instead of hardcoded endpoints, agents discover each other via a trust-weighted directory. "Find me an agent that can translate Japanese with trust score > 70."

**Why this matters:** Vouch MVP (already shipped) does this for providers. This extends it to agents. The agent economy needs agents to find each other.

**Design direction:**
- Agent publishes a "service card" (like A2A agent-card.json but with Soma trust fields)
- Service card is signed by Heart (provenance of the listing itself)
- Discovery queries: filter by capability, trust score, price range, chain, location
- DNS analog: `_soma._tcp.translate.agent` → returns agent DIDs matching query
- Trust-weighted ranking: higher-trust agents appear first
- Caching: Soma Check on discovery results (don't re-query if the directory hasn't changed)

**This composes with:** Vouch (trust ranking), Agent Labor Markets (finding workers), Cross-Protocol Interop (discoverable across ecosystems).

---

### 3.3 Agent Diplomacy / Treaty Protocols

**What:** Multi-agent agreements with cryptographic enforcement. Two agents negotiate terms (data sharing, payment splits, behavioral constraints), sign a treaty, and the treaty is enforced via mutual bond slashing.

**Why this matters:** Agent swarms need governance. Not all collaboration is hierarchical (parent/burner). Sometimes two peer agents need to agree on terms. Treaties formalize this.

**Design direction:**
- Treaty = signed agreement between N agents specifying obligations, payment terms, behavioral constraints, dispute resolution
- Both agents sign with their Heart keys (mutual attestation)
- Treaty hash stored in both agents' MMRs (traceable)
- Enforcement: if agent A violates treaty terms, agent B can submit proof (computation trace showing violation) and trigger bond slashing
- Dispute resolution: designated arbitrator agent reviews traces and rules
- Treaty termination: either party can exit with notice period, or immediate exit with penalty

---

### 3.4 Soma Physical Layer (Embodied Agents)

**What:** Heart identity for robots, IoT devices, autonomous vehicles, and other physical agents. A drone that delivers packages has a Heart that attests to its flight path, sensor readings, and delivery confirmation.

**Why this matters:** AI isn't staying digital. Physical agents need identity and trust just as much as software agents. And physical agents have harder verification problems (did the robot actually go where it said it went?).

**Design direction:**
- Hardware Heart (3.1) as the identity core for physical devices
- Sensor readings appended to MMR (GPS, camera hashes, accelerometer)
- Physical attestation: Heart signs sensor data as it's captured (real-time provenance)
- Fleet management: parent Heart manages burner Hearts for individual robots in a fleet
- Trust for physical agents: trust score based on delivery success rate, safety record, uptime

---

### 3.5 Computation Provenance NFTs

**What:** Unique computation traces minted as NFTs. "This was the first agent to solve problem X" — proved by the computation trace, minted as a collectible.

**Why this matters:** Probably gimmicky. But in a world where AI-generated content is everywhere, provenance of FIRST creation has value. Art, discoveries, solutions — if you can prove your agent computed it first (via MMR heartbeat timestamps), that proof has scarcity value.

**Design direction:**
- Mint NFT with metadata pointing to computation trace hash + MMR inclusion proof
- NFT proves: this agent (DID), at this time (heartbeat index), produced this output (hash)
- Marketplace for "first computation" proofs
- Revenue: minting fees + marketplace commission

---

### 3.6 Agent Insurance / Underwriting

**What:** Insurance products for agent operations. "If my agent causes damage due to a bug, insurance covers up to $X." Premiums priced by agent's trust score, behavioral history, and computation trace quality.

**Why this matters:** The $45M breach proves agents WILL cause financial damage. Insurance is the economic backstop. Soma's trust scores and traces are EXACTLY the actuarial data underwriters need.

**Design direction:**
- Risk model: trust score, checkpoint compliance rate, bond history, lineage depth, computation volume
- Premium pricing: higher trust = lower premium (incentivizes good behavior)
- Claims process: submit computation trace + damage evidence. Trace is verifiable — no fraud.
- Underwriter role: could be a smart contract (parametric insurance) or a traditional insurer using Soma data
- Reinsurance: multiple underwriters share risk using multi-sig escrow

---

### 3.7 Agent Collective Intelligence

**What:** Verified knowledge synthesis across agents. Agent A learns X (verified by trace), Agent B learns Y (verified by trace). A collective knowledge base emerges where every fact has provenance.

**Why this matters:** Individual agent knowledge is siloed. If agents can contribute verified knowledge to a shared pool, the pool's value grows super-linearly. But only if contributions are provably genuine (not hallucinated, not poisoned).

**Design direction:**
- Knowledge contribution: agent submits fact + computation trace showing how it derived the fact
- Trace verification: other agents verify the trace is valid
- Consensus: fact accepted into collective knowledge after N verifications
- Provenance chain: every fact traces back to the agent + computation that produced it
- Payment: agents earn $CLAWNET for contributing verified knowledge
- Access: agents pay to query the knowledge base (revenue for contributors)

**This is the "memory market" from roadmap.md Gap K, but with cryptographic provenance.**

---

### 3.8 Decentralized Heart Hosting

**What:** Instead of Heart running on a single VPS, Heart state is replicated across multiple nodes. Even if one node goes down, the agent's identity survives.

**Why this matters:** Single-VPS is a single point of failure. For high-value agents, losing the Heart state means losing the identity. Decentralized hosting = fault tolerance.

**Design direction:**
- MMR state replicated via Raft/PBFT consensus across N nodes
- Minimum 3 nodes for fault tolerance (tolerates 1 failure)
- Signing operations require t-of-n threshold signatures (no single node can forge)
- State recovery: if a node rejoins, it syncs the MMR from peers
- Cost: N× the compute, only worth it for high-value agents

**When this makes sense:** When agents manage >$10K in bonds/credits. Not for casual agents.

---

### 3.9 Streaming Proofs (Real-Time Attestation for LLM Output)

**What:** As an LLM generates tokens, each chunk gets a micro-attestation. The client can verify provenance in real-time, not just after the full response.

**Why this matters:** LLM responses can take 30+ seconds. If the client has to wait for the full response before verifying provenance, trust is delayed. Streaming proofs give trust in real-time.

**Design direction:**
- Every N tokens (e.g., every 50), Heart signs a chunk attestation: H(chunk_content || chunk_index || previous_chunk_hash)
- Hash chain links chunks — can't reorder or insert chunks
- Final attestation: root hash of the chunk chain = birth cert for the full response
- Overhead: one hash + one signature per chunk. At 272K hashes/sec and 8K signatures/sec, this is negligible
- Connects to roadmap Gap A (pay-per-chunk streaming): settlement at each signed chunk boundary

---

### 3.10 Agent-to-Human Trust Bridges

**What:** Proving agent identity to humans in a human-understandable way. Not "here's a hex signature" but "this agent has been running for 90 days, completed 5,000 tasks, has zero slashing events, and three trusted agents vouch for it."

**Why this matters:** Agents will interact with humans (customer service, trading assistants, content creators). Humans need a way to assess trustworthiness that doesn't require cryptographic literacy.

**Design direction:**
- Trust badge: visual indicator (like HTTPS padlock) showing agent's trust level
- Badge backed by verifiable credential that any auditor can check
- Summary card: human-readable trust profile (age, volume, compliance, vouches)
- QR code: scan to verify agent identity on-chain
- Browser extension: auto-verifies agent identity when interacting with AI

**This connects to:** groundbreaking-extensions.md Extension 2 (Universal Verification Badges).

---

## Cross-Cutting Themes

### Theme: Everything Composes

The power of the Soma primitive set is that everything connects:
- **MMR** (proof) + **Bonds** (economics) + **Trust scores** (reputation) + **Burner agents** (delegation) + **Death certs** (lifecycle) = a complete agent existence framework
- Each future feature above plugs into this existing primitive set. No new foundations needed — just new compositions.

### Theme: Revenue at Every Layer

Every future feature has a revenue path:
- Credit ratings: per-query fees
- Agent labor markets: commission on task payments
- Insurance: premium commissions
- Compliance reports: subscription fees
- Knowledge base: access fees
- Discovery: listing/promotion fees
- Streaming proofs: per-chunk billing
- Trading platform: trading fees

**Revenue diversification = resilience.**

### Theme: Protocol vs Product

Every feature should be designed protocol-first, product-second:
- The SPEC is open (anyone can implement)
- The IMPLEMENTATION is ClawNet (reference + premium features)
- This follows the golden-plan.md three-layer model

---

## Quick Reference: What's Where

| Topic | Document |
|---|---|
| Core protocol (5 layers) | roadmap.md §1 |
| Strategic vision | golden-plan.md |
| S/A/B-tier extensions | groundbreaking-extensions.md |
| Agent evolution scenarios | soma-future-proofing.md |
| AVS/TEE/Intent tracks | proof-of-delivery-roadmap.md |
| Heartbeat fraud proofs | heartbeat-fraud-proofs.md |
| Computation witness (MMR) | soma-computation-witness.md |
| Verified trading platform | phase5-soma-verified-economy.md |
| Token architecture | token-architecture.md |
| Provenance chain | provenance-chain-architecture.md |
| Verified data machine | verified-data-machine.md |
| Future gaps A-L | roadmap.md §4 |
| **Everything else (this doc)** | **soma-horizon.md** |
