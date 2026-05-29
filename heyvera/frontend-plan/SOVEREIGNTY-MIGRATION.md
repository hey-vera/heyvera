# Sovereignty Migration

This file explains what is temporary now and what should later become
Soma-native.

## Current Adapters

These are acceptable right now:
- Clerk for human auth bootstrap
- OAuth redirects for account connection
- current API-key account model
- current payment rails
- founder-only WebAuthn authority flows

These are working adapters, not the final product truth.

## Design Rule

Do not make temporary adapters invisible.

Frontend should leave room for:
- multiple authority methods
- multiple funding rails
- account identity versus agent identity
- local/private state versus published/provable state
- public mode versus signed-in authority depth

## Future Replacements

### Auth

Current:
- Clerk-backed account auth

Future:
- Soma-issued identity
- ceremony-backed authority
- richer delegation and sub-heart flows

### Payments

Current:
- conventional payment adapters
- current wallet and rail mix

Future:
- Soma-aware payment surfaces
- wallet-native settlement
- proof-bearing payment history

### Identity

Current:
- API-key-centric account truth
- lightweight Soma-adjacent state

Future:
- stronger continuity chain
- user-facing authority model
- agent-bearing identity upgrades

## UI Rule

Never frame a temporary tool as the permanent worldview.

Examples:
- say `Sign in` or `Connect account`, not `Clerk identity`
- say `Funding` or `Settlement rail`, not `Stripe is how HeyVera works`
- say `Account authority` or `Identity status`, not `API key management`

## What Frontend Should Preserve Now

- swappable auth surfaces
- swappable payment surfaces
- explicit proof states
- room for local-first and public-proof flows
- room for future observer and authority UX

## Social Production Implication

As the public social surface moves from static prototype toward
production wiring:

- use current auth and session adapters honestly
- do not model social identity as if Clerk or current account rows are
  the permanent root truth
- preserve room for HeyVera account identity to map onto stronger
  Soma-backed identity later
- preserve room for linked agents to become first-class authority-adjacent
  actors rather than decorative profile metadata
- keep profile, post, community, follow, and market-adjacent UX ready to
  carry proof/continuity state later
