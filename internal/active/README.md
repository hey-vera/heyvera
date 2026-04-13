# active/ -- Live Internal Workstreams

Docs here are active internal work, not automatically canonical repo truth.

Some files are current strategy, some are active plans, some are audits, and some are internal architectural thinking that still needs to be translated into canonical docs or ADRs if adopted.

If a fact should guide any contributor as shipped repo truth, put it in `docs/`.

Before creating implementation issues from an active internal doc, check `../idea-triage-index.md` and make sure the idea has a repo owner, stage, confidence, and next action.

## Typical Contents

- current strategy
- active initiatives
- gap analyses and audits
- near-term roadmap shaping
- internal design work that is relevant now

## Graduation Rule

If a doc from `active/` becomes:

- adopted repo truth -> move its durable truth into `docs/`
- an accepted structural choice -> add an ADR
- no longer current -> move it to `internal/archive/`
