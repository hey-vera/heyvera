# Pulse Strategy (HeyVera)

**Decision:** Rebuild Pulse **into** heyvera.org as a first-class product surface — do **not** vend in a standalone SPA as a separate site long-term.

Standalone code (e.g. `Synthr-Files/apps/pulse`) is **reference + feature inventory**, not a drop-in copy.

## Why rebuild, not copy

| Copy standalone | Rebuild into HeyVera |
|-----------------|----------------------|
| Second app, second deploy, second auth story | One product, one Clerk session, one shell |
| Parallel UI that drifts from social | Pulse calls the **same** `/v1/social/*` + `/v1/pulse/*` mutations as the UI |
| Harder unique brand | Pulse is the control plane of the network, not a bolt-on marketing bot |
| Short-term speed | Long-term quality Josh wants |

## Target architecture

```
User (chat / schedule / “post for me”)
        │
        ▼
  Pulse agent (Rust HeyVera backend)
        │  tools
        ▼
  Same handlers as social UI
  (create draft → approve → publish post,
   list posts, schedule later, etc.)
```

- **UI:** live at `/ai` (or renamed `/pulse`) inside the HeyVera shell — polished, not keyword theater.
- **API:** extend `crates/api` pulse module; keep draft audit trail; add chat/tools when ready.
- **Auth:** user’s Clerk JWT; agent never bypasses ownership.

## Import process when standalone arrives

1. Inventory: routes, tools, models, prompts, schedule, X/publish integrations.
2. Map each capability → existing HeyVera social/pulse endpoint or new thin endpoint.
3. Port **behavior** (tools, policies, prompts) into Rust + React — not whole folder trees.
4. Keep human approve for public actions in v1 unless Josh changes policy.
5. Delete or archive any temporary dual-run once parity is proven.

## Phasing (relative to main gameplan)

- **Now (Phase 0–1):** social golden path solid; Pulse drafts stay real; chat stays honest.
- **Phase 5:** real Pulse control plane (LLM + tools → social APIs).
- **Ongoing:** standalone repo used as a checklist of “super good” features, not source of layout clones.

## Source locations

| What | Where |
|------|--------|
| Live Pulse FE | `heyvera/src/pages/AIPage.tsx`, `heyvera/src/api/pulse.ts` |
| Live Pulse BE | `crates/api/src/pulse.rs` |
| Archived marketing-era SPA | **removed** from the tree; last present in `2e25d335^`. Recover: `git show 2e25d335^:archive/pulse/README.md` |
| External standalone (Josh) | e.g. `Synthr-Files/apps/pulse` — copy into workspace when ready |
