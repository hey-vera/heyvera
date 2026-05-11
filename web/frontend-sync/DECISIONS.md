# Frontend Decisions

Record resolved answers here so the same question does not keep coming
back.

## Entry Format

```text
## [DATE] Short decision title
- Applies to:
- Decision:
- Why:
```

## Active Decisions

## [2026-04-29] Public-site-first execution
- Applies to: current `web/` build
- Decision: only Packet 1, Packet 2, and Packet 3 are active right now
- Why: the public surface must be proven before signed-in work begins

## [2026-04-29] Living-surface model
- Applies to: all public-site design work
- Decision: `heyvera.org` is the public mode of one larger HeyVera
  surface, not a disconnected brochure
- Why: the public site needs to establish the future product worldview

## [2026-04-29] Art-direction timing
- Applies to: Packet 1 to Packet 3
- Decision: structure, hierarchy, spacing, and atmosphere come before
  deeper illustration or advanced polish
- Why: the first build should prove layout and product shape before art
  expansion

## [2026-05-11] Xotic receives execution-ready packets only
- Applies to: all Xotic handoffs after the signed-in shell baseline
- Decision: Xotic should only be assigned committed, machine-readable
  packet files with a clear file set and stop condition. Missing packet
  authoring, packet naming cleanup, sync reconciliation, status
  interpretation, and other small coordination tasks stay manager-owned.
- Why: this reduces back-and-forth, prevents chat-only scope drift, and
  keeps Xotic focused on larger implementation packets.

## [2026-05-11] `STATUS.md` scope is packet-system specific
- Applies to: branch review and sync conversations
- Decision: treat `frontend-sync/STATUS.md` as the status board for the
  packet execution lane, not as a complete index of every adjacent
  socials or experimental branch.
- Why: separate frontend tracks may move ahead on other branches without
  changing the packet-lane status document.

## [2026-05-11] Shell follow-on work uses Packet 5
- Applies to: the next Xotic shell execution handoff
- Decision: the signed-in shell baseline is treated as Packet 4 repo
  truth, and the next execution-ready packet is `PACKET-5-EXEC.md`
  for `Identity Lite`.
- Why: the repo already contains the shell baseline, but the packet docs
  previously stopped at the public-site lane and left no committed next
  packet for execution.
