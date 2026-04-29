# Execution Packets

This file turns the frontend plan into practical work packets.

Each packet should be done in order.

## Packet 1: Foundation

Scope:
- global visual tokens
- type direction
- page background and atmosphere
- layout rhythm
- shared section container patterns

Done when:
- the page already feels intentional before full content exists
- styles are not trapped in one giant component

Review after Packet 1:
- does the type scale already feel premium?
- does the background feel calm and intentional?
- is the spacing rhythm strong without content detail?
- are tokens and shared patterns clean enough for reuse?

## Packet 2: Core public sections

Scope:
- navbar
- hero
- problem
- surface map
- three pillars

Done when:
- the hero explains HeyVera fast
- the surface preview looks believable
- the surface-map section makes the future shape legible

Guardrails:
- do not turn the hero into a dashboard
- do not let the surface map become feature soup
- do not add extra sections to compensate for unclear copy

Review after Packet 2:
- can someone understand the thesis in under 10 seconds?
- does the hero preview feel like one living surface?
- does `Markets` stay contained in the surface map?
- would a smart non-technical visitor still understand the page?

## Packet 3: Supporting public sections

Scope:
- how it works
- founding network
- get started
- footer
- mobile polish

Done when:
- the page story resolves clearly
- the social/founding layer feels purposeful
- the page works well on phone

Review after Packet 3:
- does mobile still feel intentionally designed?
- do the hero and surface map remain readable on phone?
- does the founding section avoid hype-community energy?
- is the CTA honest and singular?

## Stop Gate After Packet 3

After Packet 3:
- stop
- review the result
- decide whether the public surface actually feels 10/10
- only then continue into later planning or implementation

## Packet 4: Signed-in shell prototype

Scope:
- app shell only
- static placeholder regions
- no real backend wiring yet

Regions:
- Work
- Network
- Discover
- Proof
- Identity
- Markets

Done when:
- the future app shape is visible
- public-mode thinking and app-shell thinking feel related

This packet is not active until the public site is approved.

## Packet 5: Identity Lite

Scope:
- use current real seams only
- account and identity views
- delegation management
- credential roster and ceremony UI

Done when:
- a signed-in user can understand their current identity and authority
- the surface does not pretend final Soma-native auth already exists

## Packet 6: Work Lite

Scope:
- orchestration-backed working surface
- one clean user-agent interaction loop
- no fake Vera claims beyond current truth

Done when:
- the product begins to feel like a real working surface
- it still does not collapse into a generic chatbot UI

## Packet 7: Proof / Network / Discover / Markets shells

Scope:
- shell-level region design only
- mock data where needed
- explicit seam markers for future backend work

Done when:
- the app can grow later without IA rewrites
- the unfinished regions still feel coherent

## Packet Rule

For every packet:
- build only the approved scope
- explain what changed
- stop after the packet is done
- do not jump ahead automatically
- if the structure is unclear, tighten the current packet instead of
  adding art or extra UI

## Current Active Packets

Right now, only these packets are active:
- Packet 1
- Packet 2
- Packet 3
