# Soma Verified Server Access (Rough)

This is a rough idea doc, not a committed build plan. The shape, naming, boundaries, and enforcement model may all change.

## Core Idea

Soma should not just answer "can this key SSH into a server?"

It should answer:

- which human root identity authorized this agent
- what exact scope was delegated
- what trust level is still active right now
- what actions are allowed, denied, or require step-up verification
- what tamper-evident audit trail exists for the agent's work

The important distinction is:

- the agent is not pretending to be the human
- the human creates a high-trust identity root
- the human delegates narrowly scoped authority to an agent
- the agent acts under signed, revocable, policy-checked authority

## Why This Beats Plain SSH

SSH mostly answers:

- does this credential get into the box

Soma Verified Server Access could answer:

- who delegated this agent
- whether the delegation is still valid
- whether the action fits the allowed scope
- whether current trust is high enough for this action
- whether the session should be paused, downgraded, or challenged

That is a much stronger security and accountability model than "shell access plus logs."

## Proposed Model

### 1. Human Trust Root

A human establishes a high-trust identity profile once.

Possible factors:

- passkey
- hardware-backed key
- TOTP
- wallet signature
- local biometrics
- optional premium verification such as document or advanced biometric binding

This is the trust root, not the day-to-day execution credential.

### 2. Delegation Certificate

The human signs a delegation grant for an agent.

Example delegation fields:

- owner identity id
- agent identity id
- allowed server or environment
- allowed repo or workspace
- allowed commands or capabilities
- allowed time window
- allowed spend / compute / risk budget
- required re-verification policy
- emergency revocation conditions

The key design principle is that the delegation is:

- scoped
- signed
- short-lived
- revocable

### 3. Heart-Carried Session Authority

Soma Heart carries the delegated authority during the active session.

Possible properties:

- dual-signed session token
- session hash chain
- capability list
- trust score / trust tier
- expiry / renewal policy

The session should be able to decay in trust over time if behavior changes or if the agent crosses risk thresholds.

### 4. Independent Verification

Soma Sense should independently verify the session and action legitimacy.

That separation matters because:

- Heart should not be allowed to self-attest everything forever
- independent verification makes fraud, spoofing, or drift easier to detect

### 5. Policy Runtime

ClawNet or a dedicated policy runtime should sit between the agent and sensitive actions.

Instead of broad raw shell power, the agent should get scoped capabilities like:

- read repo
- edit repo
- run tests
- build app
- deploy pulse
- restart one service
- read approved logs

The policy layer should decide:

- allow
- deny
- challenge
- downgrade privileges
- require human step-up

## True Limitation: How To Make Controls Much Stronger

The real security win is not just better login. It is better containment after login.

### Desired Controls

- agent enters through a restricted account or sandbox
- agent does not get unrestricted shell by default
- agent does not get direct root-only secret access
- agent does not inherit human fallback credentials
- dangerous operations go through a verifier / policy gateway
- delegation is short-lived and revocable
- audit trail is signed and tamper-evident

### Stronger Runtime Containment

To get closer to "10/10 practical" later:

- run agents in isolated containers or microVMs
- mount only required repo paths
- keep `/etc`, fallback keys, and unrelated apps out of scope
- separate deploy users by app or trust tier
- avoid broad Docker or sudo powers when possible

The point is not to assume compromise can never happen.

The point is to make compromise highly contained.

## Audit Trail / Trust Trail

Every important action should be attributable.

Potential receipt fields:

- human owner id
- delegated agent id
- session id
- action type
- action hash
- target environment
- timestamp
- verifier result
- trust tier at execution time

Long term, these receipts could be:

- hash-chained
- merklized
- selectively anchored
- optionally zk-assisted for compact proof of behavior / compliance

## Product Framing

Do not frame this as "more MFA."

Frame it as:

- human-rooted delegated machine authority
- continuous verified access
- scoped, signed, revocable agent execution
- tamper-evident work history
- policy-enforced server access for agents

## MVP Direction

An MVP does not need every possible factor.

Possible first version:

- human root identity
- signed delegated grants
- short-lived agent session token
- server-side policy checks for a small action set
- signed action receipts
- trust decay / re-challenge on risky actions

That would already be much more powerful than normal SSH or standard admin dashboards.

## Open Questions

- which factors belong in the trust root vs optional elite tier
- whether Heart and Sense should be separate deployable runtimes or one product surface first
- whether the first server-access MVP lives inside ClawNet, Soma, or both
- how to design capability grants without creating operational friction
- what is the minimum viable trust receipt format
- when zk proofs become worth the latency and complexity in production

## Current Position

For now, this is a strategic architecture idea and backlog item.

The current VPS hardening work remains necessary. Soma Verified Server Access would sit on top of that foundation, not replace it.
