# heyvera — vision

Captured 2026-08-04. Josh's vision, with the architectural consequences that
follow from it marked as analysis.

---

## What heyvera is

**The layer that connects humans to the network.** Somavera is the protocol —
ownerless, and once released it needs nobody. heyvera is a product that lives on
it, and unlike the protocol it may depend on its owner indefinitely. That is what
a business is.

heyvera is also **the first agent on the network**. Each page and product is a
sub-agent of it, with humans in control throughout.

## The shape

### Social — the entry point

Think x.com and YouTube combined, intertwined with Soma and Vera. People see
other agents, **assigned to real identities on the network**, doing real work
with verifiable history. Not profiles that assert competence — profiles whose
claims can be checked.

This is the front door because it is the part an ordinary person understands
without being told what a protocol is.

### Network page — the marketplace

Agents for hire. Software and packages. Services. Everything carrying its
evidence: Vera-attested, with provenance that resolves rather than being claimed.

The thing that makes this different from every other marketplace is that the
reputation is not heyvera's to grant or revoke. It lives in the protocol, and a
seller takes it with them if they leave.

### Crypto page — deliberately last

Two options were considered:

**(a) No money. Work only.** Contribution and reputation, no financial
instrument.

**(b) Trusted agents take positions; others buy into the pool.** heyvera hosts
the page, so the activity is visible and legible — *this is real, look at the
money, look at the agents on the network page.*

Josh prefers (b). See "Honest constraints" below, because (b) is a different kind
of thing from (a) and needs to be built as such.

### cortex — the coding agent

A Rust agent designed specifically to **talk to the user** and orchestrate other
AI through APIs at extreme efficiency. A user who wants to build something talks
to cortex, and cortex does the orchestration.

cortex and heyvera become Soma agents, and their work naturally produces Vera
observations. They are the first real source of the corpus.

---

## The principle underneath

**Benefit by doing real work, not by standing in the way.**

heyvera should profit from compute, hosting, data, orchestration — things that
cost something to provide and are worth something to receive. Not from being a
toll on access to something people would otherwise have free.

*Analysis:* the word for the thing to avoid is **rent-seeking**. A business built
on genuine service survives competition. One built on a toll collapses the moment
someone routes around it — and in an open protocol, routing around it is always
possible by design.

---

## Architectural consequences (analysis)

These follow from the vision rather than being separate decisions.

### heyvera must never be *able* to charge for protocol access

Not "should not" — **could not**. If the capability existed, the temptation would
eventually win. The layering already ensures this: nothing in the protocol's
frozen layer knows heyvera exists, so access cannot be gated by it.

### The crypto page must live entirely at the heyvera layer

If the protocol carries pooled positions, **the protocol inherits the regulatory
surface** — and a protocol regulators can reach is a protocol that can be ordered
to change. That is precisely the capture the whole design exists to prevent.

Financial instruments belong in the product, where being reachable is normal and
survivable.

### heyvera gets the lineage property for free

If heyvera is agent #1 and every page is a sub-agent, they all share lineage, so
their mutual attestations classify as related rather than independent — and
heyvera cannot bootstrap its own reputation internally.

**heyvera does not implement any of that.** The protocol computes it, the same
way it does for everyone. heyvera sits on top and inherits the property without
writing a line for it. That is what the layering is for: the platform gets no
exemption and needs no discipline, because the rule is not heyvera's to apply or
waive.

### Reputation is portable, and that is a feature

A seller's standing lives in the protocol, not in heyvera's database. They can
leave and take it. That is a worse business model than lock-in and a far better
product — and it is the only version consistent with the network being ownerless.

---

## Honest constraints

**Option (b) is a security.** Passive participants expecting profit from the
efforts of others is the textbook description. That is not a reason not to build
it — many people run licensed financial products — but it means counsel,
registration, and compliance, and it means the page is a regulated business
rather than a protocol feature.

**Recommendation: start with (a).** Prove the network is useful before adding the
part that makes it legally interesting. (a) also produces the evidence corpus
that would make (b) credible later.

**"zkproofed" needs a specific claim.** Zero-knowledge proofs prove a particular
statement without revealing its inputs. Before using the term publicly, decide
what statement is being proven — otherwise it reads as decoration, and the people
you most want to convince will notice.

**Trust scores must not be sold.** Computing and selling a trust score would
recreate the global aggregate the protocol deliberately refuses, and heyvera
would become the adjudicator. Sell compute, storage, verification *work*,
hosting, orchestration — services with costs. Not verdicts.

---

## Where this sits relative to the protocol

| | Somavera | heyvera |
|---|---|---|
| Owner | nobody | Josh |
| May depend on one person | never | indefinitely |
| Can be forked away | yes, by design | irrelevant |
| Contains financial instruments | never | possibly |
| Grants reputation | never | never — it lives in the protocol |
| Needs adoption to matter | no | yes |

The line between these two columns is the most important boundary in the whole
project. Everything on the left must survive the loss of everything on the right.
