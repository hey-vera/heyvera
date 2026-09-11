# ADR-0004 — Where the provider credential lives

**Status:** accepted; storage and gateway boundary implemented, worker wiring pending

**Date:** 2026-08-11; revised 2026-09-10
**Supersedes nothing. Constrains:** Phase 32.4, ADR-0002 (egress mediation).

## Context

The provider CLI runs inside the sandbox so model-authored code does not execute
on the worker host. The original implementation also copied one provider API
key into that sandbox. Scoped egress limited where the key could be exfiltrated,
but it did not prevent model-authored code from spending through the provider
outside Cortex's accounting path.

The CONNECT-only egress mediator cannot safely repair that. It forwards opaque
TLS and deliberately has no certificate authority or access to request bodies.
Injecting a credential there would require arbitrary TLS interception, greatly
expanding the trust boundary and breaking clients that pin certificates.

## Decision

Cortex uses a separate request-forwarding gateway for model API traffic:

- The gateway, never the sandbox, holds the supplier credential.
- The sandbox eventually receives a signed, short-lived capability restricted
  to tenant, run, attempt, provider, model, spending authorization, and expiry.
- The gateway accepts only explicitly supported bounded request forms.
- It acquires an atomic durable supplier-spend reservation before invoking the
  upstream transport.
- Observed usage settles the reservation exactly once. A timeout or missing
  usage remains unresolved until explicit reconciliation.
- The existing CONNECT mediator continues to enforce dependency-registry
  egress. It does not terminate provider TLS or acquire credentials.

Migration v68 and `provider_gateway` implement the capability, reservation,
settlement, mismatch, and stub-transport boundary. The worker now refuses to
copy real supplier keys into a sandbox. The public sentinel used by the stub
image remains allowed because it is not accepted by any supplier and cannot
spend money.

## Current operational state

Capability issuance is not yet carried through the brain/worker protocol and
the provider CLI is not yet pointed at a private gateway listener. Therefore a
real provider invocation currently fails closed as unauthenticated. That is
intentional: restoring live execution before per-attempt capability wiring
would reopen the spending bypass this decision closes.

The next bounded change must wire one provider only, prove the CLI's documented
gateway compatibility, and extend the adversarial sandbox test so direct
provider access fails while the private gateway succeeds. No live call is
authorized by this ADR or by the storage implementation.

## Consequences

- Supplier spend and customer credits remain separate ledgers.
- A request cannot be forwarded without finite authorization and funded global
  capacity.
- An ambiguous provider outcome consumes capacity until reconciled; retrying it
  is not treated as free.
- Rate rows remain immutable versioned data. Gateway reservations reference the
  exact price list used.
- The gateway can read supported model requests and responses. It must not log
  bodies or credentials, and its scope stays narrower than a general proxy.

## Alternatives rejected

**Leave a scoped provider key in the sandbox.** Egress scope does not prevent the
agent from using the key against the allowed provider outside Cortex's ledger.

**Inject the credential in the CONNECT mediator.** Requires TLS interception,
a trusted CA private key, request decryption, and a much larger attack surface.

**Return a provider key from a credential broker.** Moves the key one hop but
still gives it to model-authored code.

**Move the CLI to the worker host.** Reopens host execution and environment
inheritance closed by the sandbox boundary.
