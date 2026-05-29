# Homepage PR Checklist

Use this for the homepage launch PR on
`feat/heyvera-homepage-live-clean`.

## Draft PR Title

`feat(web): launch HeyVera homepage foundation`

## PR Body Draft

```md
## What Changed

- built the one-page public HeyVera homepage in `web/`
- added a reusable homepage section/layout structure
- added the homepage visual system, typography, and responsive styling
- aligned manager/frontend docs around homepage-first execution and the
  Cloudflare delivery path

## Why

- the public site needed a real homepage foundation before expanding into
  future surfaces
- the branch isolates homepage work from unrelated repo drift so it can go
  through preview and merge cleanly

## Packet Scope

- Packet: `Packet 1` / `Packet 2` / `Packet 3`
- Surface: `web/ public site`
- Branch: `feat/heyvera-homepage-live-clean`
- Draft PR?: yes
- Preview URL:

## Source Of Truth Check

- [x] I verified this change matches the current repo boundary rules.
- [x] If protocol truth changed, it was updated in `Soma` instead of
  `claw-net`.
- [x] If this changes current behavior or policy, the canonical docs were
  updated.

## Frontend Workflow Check

- [x] If this PR touches `web/`, I read the `frontend-plan/` docs first.
- [x] I stayed inside the approved packet scope.
- [x] I did not add signed-in app UI.
- [x] I did not let the page drift into dashboard UI or crypto-first
  framing.
- [x] I updated `web/frontend-sync/STATUS.md` if this changed packet state.
- [ ] I updated `web/frontend-sync/BLOCKERS.md` or `DECISIONS.md` if
  needed.
- [x] I checked mobile behavior if UI changed.

## Risk

- live publish still depends on Cloudflare Pages being correctly wired to
  the `web/` project with `main` as production
- visual sign-off should happen in a real browser preview before merge
- meta description, OG tags, and favicon are still not in scope for this
  first homepage pass

## Validation

- `npm ci`
- `npm run build`
```

## Preview Review Checklist

- confirm Cloudflare created a preview for the branch or PR
- check headline hierarchy and spacing on desktop
- check mobile layout and CTA behavior
- verify the GitHub CTA target is correct
- verify there are no routes or signed-in UI elements
- verify `Markets` stays a contained future-region mention

## Merge Checklist

- preview URL works
- manager visual review is complete
- no new frontend blockers were discovered
- branch is approved
- merge to `main`
- verify Cloudflare production publish
- verify `heyvera.org` reflects the homepage update
