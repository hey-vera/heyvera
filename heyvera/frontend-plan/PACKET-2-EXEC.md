# Packet 2 Exec

Use this file for the actual Packet 2 model run.

## Goal

Build the core public sections on top of the green Packet 1 baseline.

## Preferred Edit Targets

Prefer editing only:
- `src/App.tsx`
- `src/index.css`
- `src/components/Navbar.tsx`

Only add another component if a section becomes hard to read without
it.

## Required Sections

- Navbar
- Hero
- Problem
- Surface Map
- Three Pillars

## Required Story

- AI should belong to the person using it
- HeyVera gives you a named agent
- Vera improves it through shared intelligence
- Soma gives continuity, authority, and proof underneath

## Hard No

- no routes
- no extra pages
- no `App.css`
- no `Home` or `About`
- no signed-in app UI
- no dashboard hero
- no feature-soup surface map
- no extra sections beyond the five listed above
- no placeholder status metadata

## Done Looks Like

- a new visitor understands the thesis quickly
- the hero feels like public mode of a larger living surface
- the surface map is structural and restrained
- `Markets` is present only as one contained future region

## Packet Prompt

Use a short prompt like:

`Build only Packet 2 from this file. Prefer editing App.tsx, index.css, and Navbar.tsx only. Stop after the packet.`
