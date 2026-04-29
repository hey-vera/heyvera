# Backend Seam Map

This file classifies frontend surfaces by backend readiness.

Important:
- this file is mainly for later app planning
- do not let seam mapping slow down the public-site build

## Categories

- `Build now`
- `Design now, wire later`
- `Blocked on backend truth`

## Build Now

### Public surface

- static public site in `web/`
- no backend dependency needed

### Identity Lite

Current real seams:
- `/v1/auth/me`
- `/v1/oauth/*`
- `/v1/economy/keys/delegate`
- `/v1/economy/keys/delegated`
- `/api/authn/*`
- `/api/ceremony/*`

What frontend can show later:
- account state
- current identity status
- `has_soma_identity`
- delegation issue/list/revoke
- authenticator roster and ceremony actions

### Work Lite

Current real seam:
- `/v1/orchestrate`

What frontend can show later:
- lightweight work surface
- user query or task input
- response
- route or execution metadata

## Design Now, Wire Later

### Proof

Future dependencies:
- receipts
- lineage
- verification
- public proof lookup

### Network

Future dependencies:
- shared learning
- guilds
- social identity and trust context

### Discover

Future dependencies:
- public identity discovery
- agent discovery
- proof browsing
- later market discovery

### Markets

Future dependencies:
- wallet authority
- payment rails
- proving-ground economic surfaces

### Session mode and step-up flows

Future dependencies:
- session lifecycle routes
- authority escalation
- ceremony policy

## Blocked On Backend Truth

These should not be treated as shipped product yet:
- full trust and reputation explorer
- public receipt explorer
- provider umbrella surfaces
- native Soma payment flows
- observer-driven verification UX
- rich public social surfaces backed by stable contracts
- sub-heart upgrade flows

## Soma Rule

Soma heart is already a real backend substrate.

That means:
- frontend can speak truthfully about Soma as a foundation now
- frontend should reserve room for identity and proof UX now
- frontend should not pretend all rich Soma-derived UX is already shipped

## Adapter Rule

Frontend should keep temporary adapters visible as adapters:
- Clerk is a bootstrap auth adapter
- current payment rails are temporary settlement adapters
- API keys are current account primitives, not final identity truth

Do not let the UI hard-code those as the permanent worldview.
