# HeyVera Backend API Contract

This document defines the backend HTTP contract required by the current X-style frontend under `web/src/pages/*`, `web/src/components/shared/*`, and `web/src/api/client.ts`.

It is documentation only. It does not change the existing implementation.

## Scope

The current X-style frontend treats [`web/src/api/types.ts`](/home/runner/workspace/web/src/api/types.ts) as the UI data contract for:

- viewer profile bootstrap
- public and following feeds
- profile lookup and profile feeds
- post creation and social actions
- notifications
- conversations/messages
- search and trending
- communities
- settings-adjacent account identity needs

The frontend currently has two API clients:

- `web/src/api/client.ts`: the X-style surface this contract covers
- `web/src/api/social.ts`: a newer `/v1/social` surface used by other social views

For the current X-style frontend, the backend should satisfy the `client.ts` paths and the snake_case JSON defined in `types.ts`.

## Base URL

When `VITE_API_URL` is set, the frontend calls:

- `{VITE_API_URL}/me/profile`
- `{VITE_API_URL}/feed`
- `{VITE_API_URL}/feed/following`
- `{VITE_API_URL}/posts/*`
- `{VITE_API_URL}/users/*`
- `{VITE_API_URL}/notifications`
- `{VITE_API_URL}/conversations`
- `{VITE_API_URL}/search`
- `{VITE_API_URL}/trending`
- `{VITE_API_URL}/communities`

Recommendation: expose these routes under a stable prefix such as `/v1`, then set `VITE_API_URL=/v1`. The frontend does not require a prefix as long as the env var matches.

## Authentication

Authenticated endpoints require a Clerk-issued bearer token in the standard header:

```http
Authorization: Bearer <clerk-session-jwt>
```

Backend requirements:

- verify the Clerk token on every authenticated request
- derive the viewer account identity from the token, never from request body fields
- return `401` when the token is missing, expired, or invalid
- return `403` when the token is valid but the action is not allowed

Frontend-authenticated endpoints today:

- `GET /me/profile`
- `POST /me/profile`
- `PATCH /me/profile`
- `POST /posts` when creating as a signed-in viewer

The current UI assumes authenticated social actions for real production behavior and the X-style `web/src/api/client.ts` helpers now accept Clerk bearer tokens for these viewer-scoped calls:

- `POST /users/{id}/follow`
- `DELETE /users/{id}/follow`
- `POST /posts/{id}/like`
- `DELETE /posts/{id}/like`
- `POST /posts/{id}/repost`
- `POST /posts/{id}/bookmark`
- `GET /notifications`
- `GET /conversations`
- `GET /conversations/{conversation_id}/messages`

The backend should treat those actions as viewer-scoped reads/mutations and require authentication.

## Response Convention

The frontend currently expects successful `GET` calls to return the typed JSON body directly, not an envelope.

Examples:

- `GET /feed` returns `FeedResponse`
- `GET /users/{handle}` returns `UserProfile`
- `GET /notifications` returns `Notification[]`

Successful mutation responses should also return the primary updated resource directly where the UI already expects it:

- `POST /me/profile` returns `UserProfile`
- `PATCH /me/profile` returns `UserProfile`
- `POST /posts` returns `Post`

For action endpoints where the current UI ignores the body, backend responses may use either:

- `204 No Content`, or
- `200 OK` with a small JSON object such as `{ "ok": true }`

Recommendation: prefer `200` with JSON for easier observability and future UI expansion. The X-style API client also tolerates `204 No Content` for void mutation helpers.

## Error Convention

The frontend currently throws on any non-2xx response and surfaces the message from the HTTP status in some places. To support a clean mock-to-real migration, backend errors should use a predictable JSON shape:

```json
{
  "error": {
    "code": "PROFILE_NOT_FOUND",
    "message": "Profile not found",
    "details": null
  }
}
```

Conventions:

- `message`: human-readable summary safe to show in UI
- `code`: stable machine-readable identifier
- `details`: optional structured object for validation failures

Recommended status mapping:

- `400` invalid request, malformed cursor, unsupported media, invalid handle
- `401` missing or invalid Clerk bearer token
- `403` authenticated but not allowed
- `404` profile/post/community/conversation not found
- `409` handle conflict, duplicate repost, already following, already bookmarked if modeled that way
- `413` media too large
- `415` unsupported media type
- `422` validation failed
- `429` rate limited
- `500` unexpected backend failure

Special case:

- `GET /me/profile` should return `404` when the authenticated account has not created a HeyVera profile yet. The current frontend treats that as "no profile yet", not as a fatal error.

## JSON Shapes

All fields below are required unless marked optional.

### `UserSummary`

```json
{
  "id": "usr_123",
  "display_name": "Ava Stone",
  "handle": "avastone",
  "avatar_url": "https://cdn.example/avatar.jpg",
  "verified": true
}
```

### `MediaAttachment`

```json
{
  "id": "media_123",
  "type": "image",
  "url": "https://cdn.example/post/image.jpg",
  "thumbnail_url": "https://cdn.example/post/thumb.jpg",
  "width": 1600,
  "height": 900,
  "alt_text": "Description of the image"
}
```

`type` must be one of:

- `image`
- `video`
- `gif`

### `Post`

```json
{
  "id": "post_123",
  "author": {
    "id": "usr_123",
    "display_name": "Ava Stone",
    "handle": "avastone",
    "avatar_url": "https://cdn.example/avatar.jpg",
    "verified": true
  },
  "content": "Hello world",
  "media": [],
  "created_at": "2026-05-25T12:00:00.000Z",
  "reply_count": 4,
  "repost_count": 7,
  "like_count": 22,
  "view_count": 1042,
  "bookmarked": false,
  "liked": true,
  "reposted": false,
  "reply_to": null,
  "quote_post": null
}
```

Notes:

- `created_at` must be ISO-8601 UTC
- `media` is optional, but returning `[]` is simpler for clients
- `reply_to` is the parent post ID when this is a reply
- `quote_post` embeds another `Post` when this is a quote-post
- `bookmarked`, `liked`, and `reposted` are viewer-relative booleans and should default to `false` for signed-out viewers

### `UserProfile`

```json
{
  "id": "usr_123",
  "display_name": "Ava Stone",
  "handle": "avastone",
  "avatar_url": "https://cdn.example/avatar.jpg",
  "verified": true,
  "banner_url": "https://cdn.example/banner.jpg",
  "bio": "Builder, writer, operator.",
  "location": "New York, NY",
  "website": "https://example.com",
  "joined_at": "2025-11-01T12:00:00.000Z",
  "follower_count": 102,
  "following_count": 81,
  "post_count": 54,
  "is_following": true,
  "is_followed_by": false
}
```

Notes:

- this shape extends `UserSummary`
- `is_following` and `is_followed_by` are viewer-relative flags
- for signed-out viewers, return `false` for both flags

### `Notification`

```json
{
  "id": "notif_123",
  "type": "like",
  "actors": [],
  "post": null,
  "created_at": "2026-05-25T12:00:00.000Z",
  "read": false
}
```

`type` must be one of:

- `like`
- `repost`
- `follow`
- `reply`
- `mention`
- `quote`

### `Message`

```json
{
  "id": "msg_123",
  "sender": {
    "id": "usr_123",
    "display_name": "Ava Stone",
    "handle": "avastone",
    "avatar_url": "https://cdn.example/avatar.jpg",
    "verified": true
  },
  "content": "See you there.",
  "created_at": "2026-05-25T12:00:00.000Z",
  "read": true
}
```

### `Conversation`

```json
{
  "id": "conv_123",
  "participants": [],
  "last_message": {
    "id": "msg_123",
    "sender": {
      "id": "usr_123",
      "display_name": "Ava Stone",
      "handle": "avastone",
      "avatar_url": "https://cdn.example/avatar.jpg",
      "verified": true
    },
    "content": "See you there.",
    "created_at": "2026-05-25T12:00:00.000Z",
    "read": true
  },
  "unread_count": 1,
  "pinned": false
}
```

### `Community`

```json
{
  "id": "comm_123",
  "name": "Founders",
  "description": "Operators building in public.",
  "banner_url": "https://cdn.example/community.jpg",
  "member_count": 830,
  "is_member": false,
  "created_at": "2026-05-25T12:00:00.000Z"
}
```

### `TrendingTopic`

```json
{
  "id": "trend_123",
  "category": "Technology",
  "name": "Clerk",
  "post_count": 124
}
```

### `FeedResponse`

```json
{
  "posts": [],
  "cursor": "opaque-next-cursor",
  "has_more": true
}
```

Cursor rules:

- `cursor` is optional on the last page
- `has_more` must be authoritative
- cursors should be opaque strings, not raw offsets exposed as public contract

### `SearchResults`

```json
{
  "posts": [],
  "users": [],
  "communities": [],
  "cursor": "opaque-next-cursor"
}
```

## Endpoint Contract

### Profiles

#### `GET /me/profile`

Returns the authenticated viewer profile.

Auth:

- required, Clerk bearer token

Success:

- `200 OK` with `UserProfile`
- `404 Not Found` when the account has no HeyVera profile yet

#### `POST /me/profile`

Creates the authenticated viewer profile.

Auth:

- required

Request body:

```json
{
  "display_name": "Ava Stone",
  "handle": "avastone",
  "bio": "optional",
  "avatar_url": "https://cdn.example/avatar.jpg",
  "banner_url": "https://cdn.example/banner.jpg",
  "location": "New York, NY",
  "website": "https://example.com"
}
```

Success:

- `201 Created` or `200 OK` with `UserProfile`

Validation:

- `handle` unique, normalized, and case-insensitive
- backend should store and return the canonical normalized handle without `@`

#### `PATCH /me/profile`

Updates the authenticated viewer profile.

Auth:

- required

Request body:

```json
{
  "display_name": "Ava Stone",
  "bio": "Updated bio",
  "avatar_url": "https://cdn.example/avatar.jpg",
  "banner_url": "https://cdn.example/banner.jpg",
  "location": "New York, NY",
  "website": "https://example.com"
}
```

Success:

- `200 OK` with `UserProfile`

#### `GET /users/{handle}`

Returns a public profile plus viewer-relative follow flags.

Auth:

- optional; if a valid token is present, populate `is_following` and `is_followed_by`

Success:

- `200 OK` with `UserProfile`

#### `GET /users/{handle}/posts?cursor=<opaque>`

Returns the profile timeline.

Success:

- `200 OK` with `FeedResponse`

### Posts and Feeds

#### `GET /feed?cursor=<opaque>`

Returns the for-you or global home feed.

Success:

- `200 OK` with `FeedResponse`

#### `GET /feed/following?cursor=<opaque>`

Returns the following-only feed.

Auth:

- recommended required in production because the feed is viewer-specific

Success:

- `200 OK` with `FeedResponse`

#### `GET /posts/{id}`

Returns a single post.

Success:

- `200 OK` with `Post`

#### `POST /posts`

Creates a post.

Auth:

- required

Accepted request formats:

1. `multipart/form-data` for the current `web/src/api/client.ts` path
2. JSON body support is optional but useful if the frontend is later normalized

Required multipart fields today:

- `content`: string
- `media`: repeated file part, optional

Success:

- `201 Created` or `200 OK` with `Post`

Notes:

- if media upload is supported, return normalized `media[]` attachments in the `Post`
- current X-style frontend does not yet pass `reply_to` or `quote_post` on create, but the read contract already supports both

#### `POST /posts/{id}/like`

Marks the viewer as having liked the post.

Auth:

- required

Success:

- `200 OK` with `{ "ok": true }` or `204 No Content`

#### `DELETE /posts/{id}/like`

Removes the viewer like.

Auth:

- required

Success:

- `200 OK` with `{ "ok": true }` or `204 No Content`

#### `POST /posts/{id}/repost`

Creates or toggles a repost for the viewer.

Auth:

- required

Success:

- `200 OK` with `{ "ok": true }` or `204 No Content`

Open point:

- the current frontend only defines `POST`, not an explicit unrepost endpoint

#### `POST /posts/{id}/bookmark`

Bookmarks the post for the viewer.

Auth:

- required

Success:

- `200 OK` with `{ "ok": true }` or `204 No Content`

Open point:

- the current frontend defines bookmark but not unbookmark

### Social Graph

#### `POST /users/{id}/follow`

Follows a user by user ID.

Auth:

- required

Success:

- `200 OK` with `{ "ok": true }` or `204 No Content`

#### `DELETE /users/{id}/follow`

Unfollows a user by user ID.

Auth:

- required

Success:

- `200 OK` with `{ "ok": true }` or `204 No Content`

Implementation note:

- this route follows by `id`, while `web/src/api/social.ts` follows by `handle`
- backend should avoid exposing inconsistent semantics long term; see migration notes below

### Notifications and Messaging

#### `GET /notifications`

Returns the authenticated viewer notification list.

Auth:

- required

Success:

- `200 OK` with `Notification[]`

#### `GET /conversations`

Returns the authenticated viewer conversation list.

Auth:

- required

Success:

- `200 OK` with `Conversation[]`

#### `GET /conversations/{conversation_id}/messages`

Returns messages in one conversation.

Auth:

- required

Success:

- `200 OK` with `Message[]`

### Search, Discovery, and Communities

#### `GET /search?q=<query>`

Runs cross-entity search.

Success:

- `200 OK` with `SearchResults`

Notes:

- at least one of `posts`, `users`, or `communities` should always be present as an array

#### `GET /trending`

Returns current trending topics.

Success:

- `200 OK` with `TrendingTopic[]`

#### `GET /communities`

Returns community discovery results.

Success:

- `200 OK` with `Community[]`

#### `GET /communities/{id}/feed?cursor=<opaque>`

Returns the community feed.

Success:

- `200 OK` with `FeedResponse`

## Settings-Adjacent Account Needs

The current settings UI is mostly local-state driven, but it already expects a few account-adjacent backend-backed values:

- HeyVera handle
- viewer email or account label
- continuity state
- proof state

Current status from the code:

- handle, continuity state, and proof state can come from the authenticated profile payload
- email is still a placeholder in settings and may stay sourced from Clerk client state rather than the backend

Backend contract needed now:

- `GET /me/profile` must remain the canonical source for the signed-in HeyVera profile
- if the backend ever returns account metadata beyond the profile itself, do not overload `UserProfile` with Clerk session details unless the frontend is updated deliberately

Recommendation:

- keep authentication/account identity in Clerk
- keep social profile/account projection in HeyVera profile APIs
- only add a separate `/me/account` endpoint if the UI starts needing backend-owned account preferences, notification preferences, privacy controls, or billing state

## Mock-To-Real Migration Notes

The current frontend still carries mock-era assumptions. Backend and frontend work should converge on these rules:

1. Preserve snake_case for the X-style client.
   The current `web/src/api/types.ts` contract is snake_case. A real backend for these screens should return those field names exactly.

2. Keep `GET /me/profile` returning `404` for "profile missing".
   The profile page already relies on that distinction to show the create-profile flow.

3. Keep authenticated social actions normalized.
   The UI gates likes, follows, reposts, and bookmarks on Clerk/profile readiness and passes the Clerk bearer token into the X-style API helpers. Production backend handlers should still enforce auth server-side and never trust frontend gating as authorization.

4. Decide on one identifier strategy for follows and communities.
   The X-style client uses `/users/{id}/follow` and `/communities/{id}/feed`; the newer social client uses handle- and slug-based routes. The backend should either support both during migration or expose one canonical shape and update the stale client.

5. Decide on one post creation format.
   The X-style client posts `multipart/form-data` with `content` and optional `media`. If the long-term backend prefers JSON plus separate uploads, keep multipart compatibility until the frontend changes.

6. Stabilize action response bodies before tightening clients.
   Several current callers ignore mutation bodies. If the backend starts returning richer payloads, update the client helpers to read them intentionally rather than relying on implicit `void` behavior.

7. Treat viewer-relative booleans as first-class contract.
   `liked`, `reposted`, `bookmarked`, `is_following`, and `is_followed_by` should always be computed for the current viewer when authenticated.

8. Keep cursors opaque.
   Mock data can get away with trivial cursors; production should not leak implementation-specific pagination internals.

## Contract Gaps Still Open

These are not blockers for documenting the current contract, but they are unresolved product/API edges visible in the code:

- no explicit unbookmark endpoint
- no explicit unrepost endpoint
- no documented reply-create or quote-create request fields on the X-style client
- notifications and messaging are read-only in the current UI contract
- settings toggles for notifications/privacy/display are placeholder-only and do not yet require backend persistence

Until those are implemented, the backend only needs to satisfy the read/write paths documented above for the current frontend to move from mock responses to real data.
