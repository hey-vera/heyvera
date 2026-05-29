# HeyVera Web Pre-Flight

Run this before starting any packet work.

## Goal

Make sure you are in:
- the correct clone
- the correct branch
- the correct repo state

Do not start coding until these checks pass.

## Required Checks

Run:

```bash
pwd
git branch --show-current
git status -sb
ls web/frontend-plan
ls web/frontend-sync
```

## What Good Looks Like

- `pwd` shows your real working clone
- `git branch --show-current` shows the expected working branch
- `git status -sb` is understandable and expected
- `web/frontend-plan` exists
- `web/frontend-sync` exists

## If A Check Fails

- stop before coding
- do not guess
- do not keep working in an old or duplicate folder
- fix the repo state first

## One-Clone Rule

Use one clean verified working copy for active work.

Do not switch between random duplicate folders during the same packet.

## Post-Flight Rule

Before handing off a packet:
- make sure the packet work is visible in the actual files
- do not trust memory, chat summaries, or model narration
- if `src/App.tsx` and the changed component files do not show the work,
  the packet is not done yet
- prefer `npm run proof` over hand-typing proof commands
