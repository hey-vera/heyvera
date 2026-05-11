# Packet 4 Exec

Use this file for the actual Packet 4 model run only if Josh explicitly
asks to rebuild or refine the signed-in shell baseline.

## Goal

Create or repair the signed-in shell baseline only.

## Preferred Edit Targets

Prefer editing only:
- `src/App.tsx`
- `src/index.css`
- `src/components/app/*`
- `src/components/layout/PageShell.tsx`

## Scope

- signed-in shell layout
- left region rail on desktop
- bottom region nav on mobile
- top context bar
- region switching with local persistence
- `Home` and `Network` as live regions
- `Agent`, `Market`, and `Proof` as honest placeholders

## Hard No

- no extra routes or pages
- no generic dashboard rewrite
- no fake runtime work
- no fake market, proof, or wallet activity
- no fake identity, delegation, or ceremony controls
- no hand-edited placeholder metadata

## Done Looks Like

- the shell feels related to the public site
- region switching works cleanly
- `Home` and `Network` are visibly live
- placeholders say what is blocked and why
- mobile navigation still works

## Packet Prompt

Use a short prompt like:

`Build only Packet 4 from this file. Keep the shell honest and stop after the packet.`
