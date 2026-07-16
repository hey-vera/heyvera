# HeyVera FE ↔ BE Contract Matrix

Generated as Phase 0 lock. Frontend source: `heyvera/src/api/social.ts`, `pulse.ts`.  
Backend source: `crates/api/src/lib.rs` → `build_heyvera_router`.

Legend: **OK** mounted + used · **MISSING** FE calls / needs route · **PARTIAL** works with caveats · **ORPHAN FE** helper unused or dead

## Profiles

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| My profile | `GET/POST/PATCH /v1/social/me/profile` | OK | Primary |
| My profile alt | `GET /v1/social/profile/me` | OK | Duplicate shape |
| Create profile | `POST /v1/social/profiles` | OK | |
| List / featured | `GET .../profiles`, `.../featured` | OK | Featured = first rows |
| User by handle | `GET /v1/social/users/{handle}` | OK | Bare profile object |
| Profile by handle | `GET /v1/social/profiles/{handle}` | OK | Alias: `{ profile, linkedAgents }` |
| Linked agents | `GET .../profiles/{handle}/linked-agents` | OK | |
| Followers / following lists | `GET .../followers`, `.../following` | MISSING | |
| PATCH profile (short path) | `PATCH /v1/social/profile` | OK | Alias of `/me/profile` |
| Follow status | `GET /v1/social/follows/{handle}/status` | OK | |
| Bookmarks list | `GET /v1/social/bookmarks` | OK | Auth; keyset cursor |

## Feed & posts

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| Home feed | `GET /v1/social/feed/home` | OK | Keyset cursor |
| Following feed | `GET /v1/social/feed/following` | PARTIAL | Pagination weaker |
| Create post | `POST /v1/social/posts` | OK | |
| Get / delete post | `GET/DELETE /v1/social/posts/{id}` | OK | |
| Like / repost / bookmark | POST+DELETE on post actions | OK | **No list bookmarks** |
| User posts | `GET /v1/social/users/{handle}/posts` | PARTIAL | |
| Follow | `POST/DELETE /v1/social/follows/{handle}` | OK | |
| Follow status | `GET .../follows/{handle}/status` | MISSING | Helper may exist in DB |

## Explore

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| Search | `GET /v1/social/search` | PARTIAL | SQL LIKE |
| Trending | `GET /v1/social/trending` | PARTIAL | Hashtag counts |

## Communities

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| List | `GET /v1/social/communities` | OK | |
| Feed / join / leave | by `{id}` | PARTIAL | FE may use slug; create community MISSING |
| Mine | `GET .../communities/mine` | MISSING | |

## Messaging & notifications

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| Conversations | `GET/POST /v1/social/conversations` | OK | No realtime |
| Messages | `GET/POST .../conversations/{id}/messages` | OK | |
| Notifications | `GET /v1/social/notifications` | OK | |
| Mark read | `POST /v1/social/notifications/read` | OK | Marks all |

## Media

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| Upload URL | `POST /v1/social/media/upload-url` | PARTIAL | Mock if no R2 |
| Finalize | `POST /v1/social/media/{id}/finalize` | PARTIAL | No object HEAD verify |

## Pulse

| FE usage | Method + path | Backend | Notes |
|----------|---------------|---------|-------|
| Drafts CRUD-ish | `/v1/pulse/drafts*` | OK | approve/reject/publish/audit |
| Chat / tools agent | `POST /v1/pulse/chat` | PARTIAL | `tools_v1` deterministic create/list drafts; not full LLM |

## Phase 0 / Phase 1 priorities

1. Align FE to mounted paths only (or add thin aliases for missing GETs)
2. Golden path E2E: me/profile → posts → feed → like/reply
3. Hide UI that needs MISSING list endpoints (bookmarks folders, etc.) until built

Do not invent second path dialects. Prefer fixing FE to match `build_heyvera_router`.
