# internal/ - private company and workstream docs

Anything in this folder is private. Do not publish externally, link from public docs, or paste into outreach without redaction.

## What `internal/` Is For

`internal/` is not the same thing as `docs/`.

- `docs/` = canonical repo truth for architecture, reference, how-to, operations, proposals, and archive
- `internal/` = private company strategy, active workstreams, rough thinking, market notes, audits, and internal-only planning

If a document should guide any contributor on what is true in the repo right now, it belongs in `docs/`, not here.

If a document is private, exploratory, commercial, strategic, or still being shaped, it belongs in `internal/`.

## Folder Structure

```text
internal/
  active/             # live internal workstreams and currently relevant strategy
  backlog/            # raw ideas, incubator material, deferred concepts
  archive/            # retired internal docs
  archive-artifacts/  # displaced binaries, notes, screenshots, rough artifacts
```

## Rules

1. `active/` is for live internal workstreams, not for canonical shipped truth.
   A file can be active and still be a plan, audit, or proposal. If it becomes canonical repo truth, that truth should be written in `docs/`.

2. `backlog/` is the idea incubator.
   Brainstorms, rough concepts, future bets, and "not now" ideas live here until they either become active work or are retired.

3. `archive/` is for retired internal documents.
   Add a status header at the top when archiving:
   ```md
   Status: archived
   Outcome: completed | superseded | shelved
   See instead: <path or none>
   ```

4. `archive-artifacts/` is for non-canonical leftovers.
   Screenshots, rough text files, imported notes, and binary artifacts should live here instead of cluttering the repo root.

## Recommended Flow

Use this path for important new ideas:

1. Start in `internal/backlog/` or a GitHub Discussion.
2. Promote to `internal/active/` when it becomes a real workstream.
3. Write a canonical proposal in `docs/proposals/` if the work now has repo-level meaning.
4. Write an ADR in `docs/decisions/` if a structural decision is accepted.
5. Move superseded internal material to `internal/archive/`.

## Naming

- `{topic}-strategy.md` for strategic direction
- `{topic}-plan.md` for execution plans
- `{topic}-audit.md` for reviews or assessments
- `{topic}-proposal.md` for a shaped internal concept
- `{partner}-pitch.md` for company-facing outreach drafts

## Reading Order

1. `active/golden-plan.md`
2. `active/revenue-architecture.md`
3. `active/roadmap.md`
4. `active/gap-analysis-2026-04-07.md`
5. Then task-specific files
