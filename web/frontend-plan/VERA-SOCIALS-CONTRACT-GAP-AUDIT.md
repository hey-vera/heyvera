# Vera Socials — Contract Gap Audit

**Date:** 2026-05-11  
**Branch:** feat/vera-socials-p05-contract-gap-audit  
**Scope:** frontend-owned read of actual backend vs. actual frontend surface

---

## Executive Summary

The Vera Socials frontend (`web/src/`) is a complete social layer calling a
`/v1/social/*` API namespace. That namespace does not exist in the backend
(`src/`). There are no database tables, no route handlers, no auth middleware,
and no social data of any kind in the server.

The frontend handles this gracefully via `useFallbackDetector` — all read hooks
fall back to preview data, and write attempts fail silently with API errors. The
app looks functional, but no user data persists.

Everything in Vera Socials is currently preview-only.

---

## Backend Reality Check

### What the backend (`src/`) actually has:

| Mount point        | Purpose                        |
|--------------------|-------------------------------|
| `GET /health`      | Health probe                  |
| `POST /v1/orchestrate` | Agent orchestration (main product) |
| `GET /v1/registry` | API catalog                   |
| `/v1/auth/*`       | Clerk-backed auth              |
| `/v1/economy/*`    | API key delegation             |
| `/api/authn/*`     | WebAuthn registry              |
| `/api/ceremony/*`  | WebAuthn ceremony              |

### What the social layer needs and does NOT have:

- No `/v1/social/*` route mounted in `src/index.ts`
- No social tables in `src/db/connection.ts`
- No social route file anywhere in `src/routes/`

---

## Missing Contracts — Tiered

### Tier 1 — Read layer (everything falls back without this)

These are needed before any real data appears. All currently probe against a
nonexistent namespace; `useFallbackDetector` catches the 404 and switches the
UI to preview data.

| Endpoint | Used by |
|----------|---------|
| `GET /v1/social/feed/home` | `useHomeFeed`, `useFallbackDetector` probe |
| `GET /v1/social/profiles` | `useProfiles` |
| `GET /v1/social/profiles/:handle` | `fetchProfile` |
| `GET /v1/social/profiles/:handle/linked-agents` | `ProfileDetailPanel` |
| `GET /v1/social/profiles/featured` | `useFeaturedProfile` |
| `GET /v1/social/profiles/:handle/stats` | `useProfileStats` |
| `GET /v1/social/feed/profile/:handle` | `ProfileDetailPanel`, `AccountPosts` |
| `GET /v1/social/communities` | `useCommunities`, `AccountCommunities` |
| `GET /v1/social/longform` | `useLongform`, `AccountLongform` |

**Database tables needed:** `social_profiles`, `social_posts`,
`social_communities`, `social_longform`, `social_linked_agents`

### Tier 2 — Auth + my-profile (needed for write flows)

Clerk JWT validation on social routes is not wired. Even if the endpoints
existed, auth headers would not be verified.

| Endpoint | Used by |
|----------|---------|
| `GET /v1/social/profile/me` | `useMyProfile` (shell state gate) |
| `POST /v1/social/profiles` | `CreateProfileForm` |
| `PATCH /v1/social/profile` | `AccountEditProfile` |
| `POST /v1/social/posts` | `ComposePost`, `InlineReplyCompose` |
| `GET /v1/social/follows/:handle/status` | `ProfileDetailPanel` |
| `POST /v1/social/follows/:handle` | `ProfileDetailPanel` |
| `DELETE /v1/social/follows/:handle` | `ProfileDetailPanel` |

**Required infrastructure:** Clerk JWT middleware on `/v1/social/*` auth routes,
`social_follows` table.

### Tier 3 — Community write flows

| Endpoint | Used by |
|----------|---------|
| `POST /v1/social/communities` | `CreateCommunityForm` |
| `POST /v1/social/communities/:slug/join` | `CommunityCard`, `CommunityDetailPanel` |

**Missing:** `social_community_memberships` table.

### Tier 4 — Longform write flows

| Endpoint | Used by |
|----------|---------|
| `POST /v1/social/longform` | `CreateLongformForm` |

### Tier 5 — Agent linking (genuine upstream dependency)

| Endpoint | Used by |
|----------|---------|
| `POST /v1/social/linked-agents` | `linkAgent()` in `social.ts` (no UI yet) |

**Blocked by:** Soma identity integration. Agent link records need to be rooted
in Soma-backed identity, not just a Clerk account. This is the one tier that
is genuinely blocked on Soma, not just missing backend CRUD.

---

## Frontend-Owned Gaps (No Backend Needed)

These are gaps that exist regardless of backend state — the frontend either
references nonexistent infrastructure or describes state inaccurately.

### 1. Dead seed script reference in `FeedEmpty`

`web/src/components/public/PublicFeed.tsx`, component `FeedEmpty`:

```jsx
<p className="feed-empty-dev-hint">
  Developer? Run <code>npm run seed:social</code> to populate sample data.
</p>
```

The script `seed:social` does not exist in either `package.json`. This shows
a developer-facing message pointing at a nonexistent command. **Fixed in this
PR.**

### 2. `AccountCommunities` title claims more than it delivers

`web/src/components/app/VeraSocials.tsx`, `AccountCommunities` function:

The section title is `"Your Communities"` but the implementation only shows
communities where `c.creator.handle === myHandle` — i.e., communities you
*created*, not joined. Joining and membership tracking do not exist yet.

**Fixed in this PR:** title changed to `"Communities You Created"` with a
clarifying note.

### 3. `AccountCommunities` and `AccountLongform` use client-side fan-out filtering

Both components fetch the entire global list (`limit=50`) and then filter
client-side by the user's handle. This approach:
- Wastes bandwidth
- Breaks at scale (the first page of 50 may not include the user's items)
- Needs server-side `?author=handle` or `?creator=handle` filter params once
  the backend exists

**Not fixed in this PR** — needs backend-side query param changes.

### 4. No edit or delete post UI (or API client functions)

`PATCH /v1/social/posts/:id` and `DELETE /v1/social/posts/:id` are absent from
`social.ts` and have no UI. There is no way to edit or delete a post you've
made.

**Not blocked on Soma.** Straightforward CRUD gap.

### 5. No server-side profile search

The Profiles tab has a search input but filtering is entirely client-side (over
the first 20 profiles returned). A `GET /v1/social/profiles?q=term` endpoint
does not exist. As the network grows, client-side search over a page-limited
list becomes useless.

### 6. No community feed endpoint

`CommunityDetailPanel` shows the creator's recent posts as a proxy for a
community feed. No `/v1/social/communities/:slug/feed` endpoint exists or is
in the API client.

### 7. No pagination / load-more UI

`useHomeFeed`, `useLongform`, `useProfiles`, and `useCommunities` all return
`pageInfo` with a `nextCursor`, but no hook exposes a "load more" action and
no UI shows a pagination control.

### 8. No agent link form UI

`linkAgent()` exists in `social.ts` but there is no form component that calls
it. The `AccountLinkedAgents` section only shows a blocked note.

### 9. No quote-post UI

`FeedPost` has `quotePostId` and `createPost` accepts `quotePostId`, but there
is no quote-post button or compose UI.

---

## Affected Surfaces Map

| Surface | Affected by | Fallback behavior today |
|---------|-------------|------------------------|
| `PublicFeed` (Feed tab) | Tier 1 | Preview hardcoded data |
| `ComposePost` | Tier 2 | Write fails with API error |
| `InlineReplyCompose` | Tier 2 | Write fails with API error |
| `ProfilesTab` | Tier 1 | `status="fallback"` message |
| `ProfileDetailPanel` | Tier 1+2 | Error state shown |
| `CommunitiesTab` | Tier 1 | `status="fallback"` message |
| `CreateCommunityForm` | Tier 3 | Write fails with API error |
| `LongformTab` | Tier 1 | `status="fallback"` message |
| `CreateLongformForm` | Tier 4 | Write fails with API error |
| `PulseTab` | Tier 5 + no Vera runtime | "Waiting on Vera runtime" chips |
| `AccountTab` (You) | Tier 2 | Shell state stuck at `profile_missing` |
| `AccountPosts` | Tier 1 | Always empty or API error |
| `AccountLongform` | Tier 1 | Always empty or API error |
| `AccountCommunities` | Tier 1+3 | Always empty or API error |
| `AccountLinkedAgents` | Tier 5 | Blocked note shown |
| `AccountEditProfile` | Tier 2 | Write fails with API error |
| `SidebarFeaturedProfile` | Tier 1 | "No featured profile" fallback |
| `SidebarActiveProfiles` | Tier 1 | "No profiles yet" fallback |
| `SidebarActiveCommunities` | Tier 1 | "No communities yet" fallback |
| `SidebarAccountInfo` | Tier 2 | "Not available" fallback |

---

## Shell State Implications

`useShellState` derives state from `GET /v1/social/profile/me`:

- If the endpoint returns 404 → `profile_missing`
- If the endpoint errors → shell state stays `loading` indefinitely

Because `/v1/social/profile/me` doesn't exist, all authenticated users land in
`profile_missing` (the 404 path is caught and treated as `notFound: true`).

No authenticated user can reach `ready` shell state today. All write-gated UI
is unreachable.

---

## What Remains Blocked After This PR

| Blocker | Nature | Gate |
|---------|--------|------|
| All Tier 1–4 social endpoints | Missing backend CRUD | Build the social route + DB layer |
| Clerk JWT validation on social routes | Missing auth middleware | Wire Clerk verification into social routes |
| Agent linking | Genuine Soma dependency | Soma identity integration decision |
| Pulse automation | Vera runtime + Soma contracts | Both upstream |
| Community feed | Missing endpoint + table | Social route layer |
| Joined-communities list | Missing `social_community_memberships` endpoint | Social route layer |
| Edit/delete post | Missing endpoints + UI | Frontend + backend |
| Server-side profile search | Missing query param | Backend + small frontend |
| Pagination UI | Missing frontend component | Frontend only |

---

## Next Step Recommendation

The smallest meaningful backend slice that unblocks the most frontend surface:

1. Create social DB tables (`social_profiles`, `social_posts`, `social_follows`,
   `social_communities`, `social_community_memberships`, `social_longform`,
   `social_linked_agents`)
2. Mount a `/v1/social` Hono router in `src/index.ts`
3. Implement Clerk JWT middleware for authenticated social routes
4. Implement Tier 1 read endpoints (unlocks read-only preview with real data)
5. Implement Tier 2 write endpoints (unlocks shell state `ready`, compose, follow)

Tiers 3 and 4 (community and longform writes) follow naturally from that
foundation.

Agent linking (Tier 5) and Pulse are genuinely deferred — they belong in a
separate proposal once the Soma identity integration path is decided.
