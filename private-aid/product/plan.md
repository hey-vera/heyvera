# ClawNet Product — Build Plan

> Everything that's ClawNet-specific and NOT part of the AID protocol family.
> These features are the competitive moat. Never submit to DIF.
> Split from AIDplan on March 24, 2026.

## What's Product (Not Protocol)

### Autonomous Defense System (Part 3 C)
- Proof of life (dead man's switch, weekly heartbeat, decay schedule)
- Counterparty immune response (3/5/10 reporter thresholds, auto-quarantine)
- Progressive behavioral containment (anomaly score → throttle → freeze)
- Guardian agents (agents monitoring agents, 2-of-3 multi-sig freeze)
- Guardian-as-a-Service marketplace
- Trust score gravity well (natural decay, convergence-triggered exponential)
- Recovery keys (2-of-3 multi-sig)
- Identity succession (20%/50%/retired penalties)
- Insurance fund (2% deferred volume, parametric triggers, actuarial model)

### Social & Market Layer
- Agent social graph (follow/endorse/block, cross-consumption tracking)
- Season framework (12 scoring dimensions)
- Bonding curve contract (reputation-only staking, no revenue share)
- Cross-consumption tracking + trust boost
- Public agent explorer page
- Competitive trust leaderboard

### Skills & Execution
- No-code skill builder (natural language → skill definition)
- Visual MCP workflow builder
- Composite skills (output piping, parallel, conditionals, max depth 3)
- Skill health cron (auto-mark DEGRADED, SLA checks, penalty escalation)
- Skill scheduler cron (cron-based execution, session state injection)
- Autonomous hiring/firing (auto-replace degraded deps)

### Governance
- Proposal system (quorum, bonds, voting)
- Validator roles (admin-promoted, 0.5cr reward, daily limit 100)
- Structured reports (security, spam, copyright, quality, misleading)
- One-operator-one-vote Sybil resistance

### Infrastructure
- Smart cache v2 (L1 memory + L2 Redis, SWR, negative caching)
- Endpoint auto-discovery (polls clawapis.com every 4h)
- Dynamic credit pricing (surge, volume discounts, off-peak)
- Telegram bot integration
- X-outreach marketing bot
- MCP tool server (6 tools)

### Cherry Features (Phase 1-4)
- Trust score explanation + prediction APIs
- Composable trust policies (DSL)
- Adversarial trust testing (red team as a service)
- Agent capability marketplace
- Trust-weighted agent discovery
- Cross-protocol trust passport (W3C VP)
- Trust score NFT (soulbound, ERC-5192)
- Agent forensics API
- Trust-aware DNS
- Real-time trust streaming for orchestrators

## Open Concerns (Product-Specific)

### O5: Guardian Accountability
Who watches the watchers? Precision tracking helps but guardian-oracle circularity is unsolved. See master open-concerns O5.

### O8: Autonomous Defense Needs Critical Mass
5-layer defense designed for 10K+ agents. Current scale: 0. Minimum viable sizes per layer range from 50 to 500+ agents. See master O8.

### O11: Bus Factor = 1
One person building all of this. DIF engagement + code + community = bandwidth overload. See master O11.
