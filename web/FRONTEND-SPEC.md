# HeyVera Frontend Spec — Source of Truth

> X.com-style social platform. This file is the single source of truth for all frontend work.
> Every change must match this spec. If something here is wrong, update this file FIRST, then code.

## Stack

- React 19 + TypeScript + Vite 7 + Tailwind CSS v4
- react-router-dom (createBrowserRouter)
- Clerk auth (conditional on VITE_CLERK_PUBLISHABLE_KEY)
- API client with mock data layer (swap-ready for Rust backend)

## Architecture

```
web/src/
├── api/
│   ├── types.ts        # All TypeScript interfaces (Post, UserProfile, etc.)
│   ├── mock.ts         # Realistic mock data
│   ├── client.ts       # API client — mock when no VITE_API_URL, real fetch when set
│   └── social.ts       # Legacy API (do not extend, will be retired)
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx    # 3-column responsive shell (the main wrapper)
│   │   ├── LeftNav.tsx     # Left sidebar navigation
│   │   ├── RightRail.tsx   # Right sidebar (search, trending, suggestions)
│   │   ├── BottomBar.tsx   # Mobile bottom tab bar
│   │   └── TopBar.tsx      # Mobile/tablet top bar
│   └── shared/
│       └── PostCard.tsx    # Post/tweet card — the most important component
├── pages/
│   ├── HomePage.tsx
│   ├── ExplorePage.tsx
│   ├── NotificationsPage.tsx
│   ├── MessagesPage.tsx
│   ├── BookmarksPage.tsx
│   ├── CommunitiesPage.tsx
│   ├── PremiumPage.tsx
│   ├── ProfilePage.tsx
│   ├── SettingsPage.tsx
│   ├── AIPage.tsx
│   └── PostThreadPage.tsx
├── router.tsx          # All routes, uses AppShell as root layout
├── main.tsx            # Entry point, ClerkProvider + RouterProvider
└── index.css           # Theme CSS variables + Tailwind
```

## Layout — 3-Column Responsive (X.com pattern)

```
Desktop  (≥1280px):  [LeftNav 275px labels+icons] [Feed 600px] [RightRail 350px]
Tablet   (1024-1279): [LeftNav 88px icons-only]    [Feed 600px] [RightRail 290px]
Narrow   (640-1023):  [LeftNav 88px icons-only]    [Feed 100%]
Mobile   (<640px):    [Feed 100%] [BottomBar 49px] [TopBar 53px]
```

- LeftNav: fixed, full viewport height
- RightRail: sticky, hidden below lg (1024px)
- BottomBar: fixed bottom, visible only below sm (640px)
- TopBar: sticky top with backdrop-blur, visible only below lg (1024px)
- Center column: max-width 600px, border-left + border-right 1px #2F3336

## Dark Theme Colors

| Token | Hex | Usage |
|-------|-----|-------|
| --bg-primary | #000000 | Page background |
| --bg-elevated | #16181C | Cards, inputs, elevated surfaces |
| --bg-hover | #080808 | Card hover state |
| --border-primary | #2F3336 | Dividers, card borders |
| --border-secondary | #38444D | Secondary borders |
| --text-primary | #E7E9EA | Body text, display names |
| --text-secondary | #71767B | Handles, timestamps, meta |
| --accent | #00BA7C | HeyVera green (NOT X blue) — CTAs, active states |
| --accent-hover | #00D68F | Accent hover |
| --color-reply | #1D9BF0 | Reply action |
| --color-repost | #00BA7C | Repost action |
| --color-like | #F91880 | Like action |
| --color-danger | #F4212E | Error states |

## Typography

- Font: system stack (-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial)
- 13px: meta text (counts, timestamps in action bar, category labels)
- 15px: body text, display names, handles, tab labels — this is the default
- 20px: page headers, compose box text, nav labels
- 23px: large titles (profile display name on profile page)
- Bold (700): display names, active nav items, headers
- Regular (400): body text, handles, inactive nav items

## Navigation Items

### LeftNav (desktop/tablet)
| # | Label | Icon | Route |
|---|-------|------|-------|
| 0 | HeyVera logo | HV circle | /home |
| 1 | Home | 🏠 | /home |
| 2 | Explore | 🔍 | /explore |
| 3 | Notifications | 🔔 | /notifications |
| 4 | Messages | ✉️ | /messages |
| 5 | Bookmarks | 🔖 | /bookmarks |
| 6 | Communities | 👥 | /communities |
| 7 | Premium | ⭐ | /premium |
| 8 | Profile | 👤 | /profile |
| 9 | More | ••• | dropdown menu |
| — | Post button | — | opens compose modal |

### BottomBar (mobile, 5 items)
| Icon | Route |
|------|-------|
| 🏠 | /home |
| 🔍 | /explore |
| ⭐ | /ai |
| 🔔 | /notifications |
| ✉️ | /messages |
+ FAB compose button (bottom-right, accent green circle)

## PostCard Spec (web/src/components/shared/PostCard.tsx)

The most important component. Must match X.com tweet anatomy:

```
[Avatar 40px] [DisplayName (bold)] [✓ badge] [@handle (gray)] · [timestamp (gray)]
              [Post body text — 15px, white, pre-wrap]
              [Media attachment — rounded-2xl, if present]
              [Quote post card — bordered embed, if present]
              [Action bar — evenly spaced:]
               💬 Reply  🔄 Repost  ❤️ Like  📊 Views  🔖 Bookmark  ↗️ Share
```

- Avatar: 40px circle, 12px gap from content
- Action icons: 16px emoji (placeholder), will be replaced with proper icons
- Action counts: 13px, gray, only shown when > 0
- Hover: each action gets colored circular bg at 10% opacity
- Interactive: like/repost/bookmark toggle state locally + call API
- Card hover: bg-white/[0.03]
- Card separator: border-bottom 1px #2F3336

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| / | redirect → /home | |
| /home | HomePage | Feed with For You / Following tabs + compose box |
| /explore | ExplorePage | Search + trending topics |
| /notifications | NotificationsPage | All / Verified tabs, notification items |
| /messages | MessagesPage | Split-panel: conversation list + chat |
| /bookmarks | BookmarksPage | Saved posts list |
| /communities | CommunitiesPage | Your Communities / Discover tabs, cards grid |
| /premium | PremiumPage | Monthly $6.99 / Annual $69 pricing cards |
| /profile | ProfilePage | Own profile |
| /profile/:handle | ProfilePage | Other user's profile |
| /settings | SettingsPage | Two-panel settings with section menu |
| /ai | AIPage | Placeholder for AI assistant |
| /post/:id | PostThreadPage | Single post view loaded through `getPost(id)` |

## API Client (web/src/api/client.ts)

All data loading goes through this client. When `VITE_API_URL` is empty, returns mock data. When set, makes real fetch calls to the Rust backend.

**Available functions:**
- `getFeed(cursor?)` → FeedResponse
- `getFollowingFeed(cursor?)` → FeedResponse
- `getPost(id)` → Post
- `createPost(content, media?)` → Post
- `likePost(id)` / `unlikePost(id)`
- `repostPost(id)`
- `bookmarkPost(id)`
- `getNotifications()` → Notification[]
- `getConversations()` → Conversation[]
- `getMessages(conversationId)` → Message[]
- `searchAll(query)` → SearchResults
- `getTrending()` → TrendingTopic[]
- `getUserProfile(handle)` → UserProfile
- `getProfilePosts(handle)` → FeedResponse
- `followUser(id)` / `unfollowUser(id)`
- `getCommunities()` → Community[]
- `getCommunityFeed(id)` → FeedResponse

**Rule: Pages must load data from the API client, not hardcode content.**

## Remaining Polish Work (priority order)

### P0 — Must do
- [x] Replace emoji icons with lucide-react or custom SVG icons across LeftNav, BottomBar, PostCard action bar
- [x] Connect HomePage to `getFeed()` — render PostCards from mock data
- [x] Connect ExplorePage to `getTrending()`
- [x] Connect NotificationsPage to `getNotifications()`
- [x] Connect CommunitiesPage to `getCommunities()`
- [x] Connect ProfilePage to `getUserProfile()` + `getProfilePosts()`
- [x] Add loading spinners/skeletons while data loads

### P1 — Should do
- [x] Like heart animation (CSS sprite or scale+color transition)
- [x] Hover states on all interactive elements (nav items have pill bg, cards have subtle bg change)
- [x] Compose modal: media upload placeholders, character counter, emoji picker placeholder
- [x] Messages: clicking a conversation shows messages in right panel
- [x] Profile: render actual PostCards in tabs
- [x] Settings: clicking a section shows its options in right panel
- [x] Search functionality in ExplorePage
- [x] Post thread route loads a post through `getPost(id)` and renders `PostCard`

### P2 — Nice to have
- [x] Infinite scroll (intersection observer + cursor pagination)
- [x] Pull-to-refresh on mobile
- [x] "Show N new posts" banner at top of feed
- [x] Bookmark folders
- [x] Community feed view
- [x] Reply threading with vertical connector lines
- [x] Repost dropdown menu (Repost vs Quote)
- [x] Share dropdown menu

## Rules for Workers

1. **Never modify the layout shell** (AppShell, LeftNav, RightRail, BottomBar, TopBar) without updating this spec first
2. **Never add new routes** without adding them to this spec first
3. **Always use the API client** — never hardcode data in page components
4. **Always use CSS variables** for colors — never hardcode hex values that aren't in the theme
5. **Mobile-first** — base Tailwind classes are mobile, use sm:/md:/lg:/xl: for larger screens
6. **Dark theme only** — no light mode toggle, no light mode styles
7. **TypeScript strict** — no `any`, no `// @ts-ignore`, all props typed
8. **Test the build** — run `npx tsc --noEmit && npx vite build` before committing
9. **PostCard is sacred** — changes to PostCard affect every feed view. Test thoroughly.
10. **Accent color is green (#00BA7C)** — not blue. HeyVera is not X.

## Cloudflare Deployment

- Auto-deploys on push to `main`
- Root directory: `/web`
- Build command: `npm run build`
- Build output directory: `dist` (NOT `/dist`)
- No submodules allowed in the repo

---

*Last updated: 2026-05-22. This file is the spec — code follows it, not the other way around.*
