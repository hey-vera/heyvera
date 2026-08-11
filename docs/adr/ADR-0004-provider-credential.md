# ADR-0004 — Where the provider credential lives

**Status:** accepted, with the target unimplemented
**Date:** 2026-08-11
**Supersedes nothing. Constrains:** Phase 32.4, ADR-0002 (egress mediation).

## Context

The provider CLI runs **inside** the sandbox. That is a deliberate choice from
PR C, not an accident: `executor.rs` builds the `SandboxRequest` from
`invocation.program`, the host fallback was deleted, and the agent process is
confined along with everything it writes. Moving the CLI back out would return
the model process to the host with the worker's environment inherited, which is
the exposure PR C exists to close.

A CLI inside the sandbox needs the provider API key inside the sandbox. So
model-authored code — the code the agent writes and, on many tasks, runs — shares
a process environment with a live credential that can spend money.

Phase 32.4 says no provider credentials in the sandbox. This is a violation of
it, and it is recorded as gate **G3** in `ADR-0003`.

It shipped anyway. The alternative was leaving F7 open, and F7 is not a
degradation: a sandboxed agent with no route to any model API cannot execute a
single step. Cortex had not executed one since PR C merged. An orchestrator that
has never run a task is not more secure than one that has; it is only untested,
and every capability claim downstream of it is unverified.

## Decision

**Today:** the key enters the sandbox as exactly one environment variable,
admitted by the same capability grant that opened the provider's host.

**Target:** the mediator injects the credential on the way out, and the sandbox
holds only a placeholder. The agent never has the secret; a request leaving the
sandbox acquires it at the boundary.

## Why the target is not free

This is the part that should stop anyone implementing it casually.

The mediator is **CONNECT-only**. It forwards an opaque TLS stream and never
terminates it. That property is load-bearing in ADR-0002: it is why the mediator
cannot read or alter task traffic, why it needs no certificate authority, why it
holds no private key worth stealing, and why "the mediator was compromised" is a
smaller sentence than it would otherwise be.

Injecting a credential into an HTTPS request means **reading and rewriting that
request**, which means terminating TLS for the provider host, which means:

1. A CA the sandbox must trust, and therefore a private key on the mediator that
   can mint certificates for the provider's domain.
2. The mediator becomes able to read the full content of every model request and
   response — the task's code, the repository content in the prompt, the model's
   output. Today it can read a hostname.
3. A second code path with different security properties for one host, which is
   the shape that rots: the CONNECT path stays simple and the intercepting path
   accretes.
4. Certificate pinning in any provider CLI breaks, and breaks in a way that
   looks like a network fault.

Terminating TLS was avoided deliberately. **Reversing that to solve a credential
problem trades a bounded exposure for an unbounded one**, and would be a bad
trade taken in the name of a checklist item.

## What has to be true before the target is built

- A statement of what the mediator may log and retain once it can read request
  bodies, enforced in code rather than asserted.
- The CA key handled at least as carefully as the provider key it replaces —
  otherwise the exposure has moved rather than closed.
- A provider whose CLI tolerates an intercepting proxy, verified against the
  real CLI rather than against a stub.

If those cannot be met, the honest answer is that the credential stays in the
sandbox and is bounded by its **scope and lifetime** instead, which is the
mitigation below.

## The mitigation that applies now

Use the shortest-lived, narrowest-scoped provider credential the API supports.
This is the one control that meaningfully bounds G3 today, and it is an
operational decision rather than a code one:

- A key scoped to a single workspace or project, never an org-wide key.
- A spend cap on the key itself, so the blast radius is a number, not a
  possibility.
- Rotation on a schedule short enough that a leaked key expires before it is
  worth selling.

The reason this is the real control: the sandbox's egress is already narrowed to
exactly the routed provider's host, so a key cannot be exfiltrated to an
arbitrary endpoint *from inside the sandbox*. What it can still do is be **used**
against the provider by the agent itself. Scope and lifetime bound that; network
policy does not.

## Alternatives rejected

**Move the CLI out of the sandbox.** Destroys Phase 0.1 and reopens the exposure
PR C closed. Not on the table.

**A short-lived token minted per attempt by the worker.** The right shape, and
unavailable: the provider APIs in use issue long-lived keys, not per-request
tokens. Worth revisiting the day any of them ships an equivalent of STS.

**A credential-broker sidecar on the internal network that the CLI authenticates
to.** Moves the secret one hop without removing it from the sandbox's reach —
the sandbox can still ask the broker for it, because the CLI must. It adds a
component and changes nothing about what model-authored code can obtain.

**Do nothing and leave F7 open.** Rejected. See Context: an untested orchestrator
is not a secure one.
