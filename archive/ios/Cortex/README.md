# Cortex iOS

Native SwiftUI client for the Cortex BYOS backend — AI coding from your phone, connected
to your personal Cortex container and Claude/OpenAI subscription.

## Architecture

```
Cortex/
  App/                 App entry, root router, config, Info.plist
  Core/
    Auth/              AuthSession — Clerk hosted sign-in + JWT/Keychain caching
    Networking/        APIClient (REST) + ChatStreamClient (SSE)
    Storage/           KeychainStore
    Models/            Codable models mirroring the Rust API contracts
  Features/
    Auth/              SignInView, SettingsView
    Projects/          ProjectListView, ProjectDetailView
    Chat/              ChatListView, ChatView (streaming) + view models
    Files/             Read-only FileBrowserView / FileViewerView
  Shared/              Reusable UI (ContentUnavailableViewCompat)
  Config/              Cortex.xcconfig (Clerk key)
```

- **MVVM**: each feature has an `ObservableObject` view model; views are thin.
- **Networking**: `APIClient` is an `actor`; every request sends the Clerk JWT as
  `Authorization: Bearer <token>`. `ChatStreamClient` consumes the `/api/chat`
  Server-Sent Events stream as an `AsyncThrowingStream`.

## Backend contract (verified against `crates/api`)

| Feature        | Endpoint                          | Notes |
|----------------|-----------------------------------|-------|
| Auth status    | `GET /api/auth/status`            | `[ProviderAuthInfo]` |
| Connect provider | `POST /api/auth/start` / `submit` | subscription / api_key flows |
| Projects       | `GET /api/projects`               | `{ workspaces: [...] }` |
| Project detail | `GET /api/projects/{id}`          | |
| Conversations  | `GET/POST /api/conversations`, `GET /api/conversations/{id}` | |
| Chat (stream)  | `POST /api/chat`                  | **SSE** — `StepEvent` frames (`type: started/output/completed/failed`) |
| Profile        | `GET /api/user/profile`           | |

> The live chat channel is **Server-Sent Events**, not WebSocket. `/api/ws` is the
> worker socket and `/api/mc` is the mission-control observer socket — neither carries
> user chat. The SSE client streams assistant tokens incrementally.

> A per-project file-listing endpoint does not yet exist on the backend. The file
> browser is built against a `FileService` protocol and currently offers an "open
> workspace" fallback; wire `LiveFileService` to `GET /api/projects/{id}/files` when
> that route ships.

## Build

This repo stores the project as a declarative [XcodeGen](https://github.com/yonigozman/XcodeGen)
spec so the `.xcodeproj` is reproducible.

```bash
brew install xcodegen
cd ios/Cortex
xcodegen generate
open Cortex.xcodeproj
```

1. Set your Clerk publishable key in `Cortex/Config/Cortex.xcconfig`
   (`CLERK_PUBLISHABLE_KEY = pk_live_...`). Use the same value as the web app's
   `VITE_CLERK_PUBLISHABLE_KEY`.
2. Select your signing team in Xcode (Signing & Capabilities).
3. The custom URL scheme `cortexapp://auth-callback` is registered for the OAuth
   redirect — ensure it is allowed as a redirect URL in your Clerk dashboard.
4. To target a local backend, set `CORTEX_API_BASE` (e.g. `http://localhost:3001`)
   in the Run scheme's environment variables. Defaults to `https://cortex.heyvera.org`.

## Auth flow

1. `SignInView` launches Clerk's hosted sign-in in an `ASWebAuthenticationSession`.
2. Clerk redirects to `cortexapp://auth-callback` carrying the session JWT.
3. The JWT is cached in the Keychain and presented as a Bearer token on every call.
4. `AuthSession` decodes the JWT `exp` locally to prompt re-auth on expiry.

> For production, dropping in Clerk's native iOS SDK (token auto-refresh, MFA) is a
> clean upgrade — `AuthSession`'s token-provider seam already isolates the rest of the
> app from the auth mechanism.
