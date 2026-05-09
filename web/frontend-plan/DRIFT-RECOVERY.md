# Drift Recovery

Use this file when the model starts going off-track.

## Common Drift Signs

- it mentions `App.css`
- it mentions `Home`, `About`, or routing
- it tries to use repo-root `src/` instead of `web/src/`
- it writes filler like `Welcome to the Public Site`
- it says a packet is done but `npm run proof` does not show the work
- it tries to hand-type fake branch names or commit hashes

## First Recovery Prompt

Use this first:

```text
Stop. Re-read the current PACKET-N-EXEC.md file. Make the smallest working edit only. Do not add routes, pages, App.css, filler copy, or placeholder metadata. Stay inside the current packet and stop after it.
```

## If It Still Drifts

Tighten the file scope:

```text
Edit only src/App.tsx, src/index.css, and src/components/Navbar.tsx unless the packet explicitly requires one more file.
```

## If Repo Location Feels Wrong

From `web/`, run:

```bash
pwd
find src -maxdepth 3 -type f | sort
```

Good output should be the small frontend file set, not backend files
like `src/index.ts` or `src/routes/*`.

## If A Packet Claims Completion

Run:

```bash
npm run proof
```

If the file list and `src/App.tsx` do not visibly show the packet
scope, the packet is not done.

## If Status Feels Wrong

Do not type hashes manually.

Run:

```bash
npm run status:update -- "Packet N" yes
```

## If The Model Is Too Lost

Stop the run and restart with:
- `PRE-FLIGHT.md`
- `CONVENTIONS.md`
- `AIDER-COMMANDS.md`
- the current `PACKET-N-EXEC.md`

Do not reload the full planning stack unless Josh says the docs changed.
