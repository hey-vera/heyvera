# internal/ — private strategy docs

Anything in this folder is **private**. Do not publish externally, link from public docs, or paste into outreach without redaction.

## Folder Structure

```
internal/
  active/    -- CURRENT TRUTH. If it's here, trust it.
  backlog/   -- Future ideas. Explicitly "not now." Never stale.
  archive/   -- Completed, superseded, or shelved. Preserved with status headers.
```

### Rules

1. **`active/`** -- Only docs that reflect current reality or active build plans. When something ships, gets replaced, or becomes outdated, move it to `archive/` with a status header. If you read a file in `active/`, you can trust every line.

2. **`backlog/`** -- Ideas, brainstorms, future extensions, "what if" docs. These are explicitly "someday" -- they can't go stale because they make no claims about current state. Good ideas live here until they graduate to `active/` when it's time to build.

3. **`archive/`** -- Everything that shipped, was superseded, or paused. Every file gets a 3-line header at the top:
   ```
   > **ARCHIVED** -- [Completed|Superseded|Shelved] on YYYY-MM-DD
   > **Outcome:** [what shipped / what replaced it / why paused]
   > **See instead:** [path to current doc, if applicable]
   ```
   Original content stays intact below the header. Never delete good ideas.

### Moving files between folders

- **active/ -> archive/:** When a plan ships or gets replaced. Add the archive header.
- **active/ -> backlog/:** When work is paused but the plan is still valid for later.
- **backlog/ -> active/:** When it's time to build. Review and update before promoting.
- **archive/ -> backlog/:** When a shelved idea becomes relevant again. Remove the archive header.

## Convention

- Internal strategy, roadmaps, pricing analysis, partner pitches, competitive positioning, revenue models go here.
- Public-facing engineering docs (architecture, billing mechanics, integration guides) go in `docs/`.
- Public protocol specs, API references, philosophy go in their respective project repos.

## Naming

- `{topic}-strategy.md` for comprehensive strategy on one topic
- `{topic}-plan.md` for time-phased build/roll-out plans
- `{topic}-spec.md` for protocol/technical specifications
- `{partner}-pitch.md` for partner-specific outreach drafts

## Reading order (for new conversations)

1. `active/golden-plan.md` -- master strategic vision (read first)
2. `active/revenue-architecture.md` -- current revenue model (free routing, paid trust)
3. `active/roadmap.md` -- what to build and why
4. `active/gap-analysis-2026-04-07.md` -- honest codebase audit
5. Then whatever's relevant to the task at hand
