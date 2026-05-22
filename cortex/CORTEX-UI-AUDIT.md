# Cortex UI Audit — Brutal Honest Assessment

> Written after reading every component in `cortex/src/`. No smoke, no assumptions.

---

## Part 1: What Makes $1B Products Feel Real

These aren't features — they're structural decisions that separate "dev project" from "product."

### 1. Clear Information Hierarchy (Linear, Vercel)
Every page has ONE primary action and ONE primary piece of information. Everything else is secondary or hidden. Linear's sidebar: projects → issues. Vercel dashboard: deployments at a glance. No clutter.

### 2. Command Palette as Connective Tissue (Cursor, Linear, Notion, Figma)
`Cmd+K` is the universal nav. Every action reachable from one place. This is non-negotiable for developer tools.

### 3. Persistent Navigation That Doesn't Compete (GitHub, Stripe)
Sidebar exists but doesn't dominate. Content area is king. Nav items are icons or short labels, never both fighting for space.

### 4. Progressive Disclosure (Stripe Dashboard, Vercel)
Default view is clean. Details reveal on click/hover/expand. Never show 8 sections at once on load.

### 5. Polished Empty States (Linear, Notion, Vercel)
First-time users see a welcoming empty state with illustration + single CTA, not a blank canvas with scattered labels. This is the first impression — it IS the product for the first 30 seconds.

### 6. Toast Notifications + Status Bar (VS Code, Cursor, Vercel)
Actions confirm with toasts. System state lives in a status bar or subtle indicator, not inline text. "Workspace connected" as inline text under the header is amateur.

### 7. Split Pane Resizable Layouts (Cursor, Replit, VS Code)
When you have chat + output, users MUST be able to resize panels. Fixed 320px side panel is a red flag.

### 8. Contextual Actions (GitHub, Linear)
Right-click menus, hover actions, `...` menus on items. Not everything needs a dedicated button. Conversation items should have rename/delete/pin on hover.

### 9. Keyboard-First With Visual Hints (Cursor, Linear)
Show shortcuts inline: "New chat ⌘N" not just an icon. Power users see this and trust the product.

### 10. Consistent Component Language (Stripe, Linear)
Every card, every button, every badge uses the same design tokens. No mixing of border-white/8 and border-white/6 and border-white/10 randomly. Cortex currently has all three in one file.

---

## Part 2: Component-by-Component Grades

### App.tsx — App Shell (Grade: C-)

**What it is:** 597 lines of state management, modals, and layout in one file.

**Problems:**
- No router. Everything is modals and boolean state toggles (`settingsOpen`, `adminOpen`, `checkoutOpen`, `workSurfaceOpen`, `sidebarOpen`). That's 5 boolean flags creating 32 possible states. This is a state management nightmare.
- No URL-based navigation. You can't link to `/settings` or `/admin` or `/runs`. Can't refresh and return to where you were. Every other SaaS has URL-based routes.
- Header is too thin and generic. "New chat" with "Workspace connected" underneath looks like a template, not a product.
- Mobile sidebar is a duplicated `<Sidebar>` render (lines 378-421), not a responsive toggle.
- The "Run bridge" detection (`looksLikeRunGoal`) is a regex heuristic embedded in the app shell. This is clever but fragile and belongs in a service, not a render component.

**Production quality looks like:** React Router with real routes (`/chat/:id`, `/runs`, `/settings/billing`). App shell is <100 lines — just layout + providers.

### Sidebar.tsx (Grade: C)

**What it is:** 725 lines. Conversation list, new chat button, settings/admin links.

**Problems:**
- 725 lines for a sidebar is too much. It's doing conversation CRUD, grouping by date, inline renaming, and navigation all in one component.
- No search/filter for conversations. With 50+ conversations this becomes unusable.
- No conversation pinning, folders, or projects. Just a flat chronological list like ChatGPT v1.
- The "HeyVera Cortex" branding at top takes up prime sidebar real estate but adds nothing after the first visit.
- Settings/Admin links are at the bottom as small icons. Admin is hidden behind an `isAdmin` check with no visual distinction.
- No indication of which conversations have active runs or pending approvals.

**Production quality looks like:** Cursor's sidebar — workspace selector at top, collapsible sections (Pinned, Recent, All), search bar, keyboard nav, status dots on active items.

### ChatComposer.tsx (Grade: C+)

**What it is:** 114 lines. Textarea + send button.

**Problems:**
- It's a textarea with a send button. That's it. No file attachment, no mention system, no slash commands.
- The "locked" state for billing just disables the input. Should show what's locked and why, with a clear CTA.
- No model selector. Users can't choose which AI model to use per-message.
- No context indicators — user doesn't know what files/repos the AI has access to.
- Send button with ↑ arrow is fine but there's no keyboard shortcut hint.

**Production quality looks like:** Cursor's composer — model selector dropdown, @ mention for files, `/` commands, attachment button, clear context chips showing what's loaded.

### ChatTimeline.tsx + ChatMessage.tsx (Grade: C)

**What it is:** 112 + 92 lines. Message list with assistant/user bubbles.

**Problems:**
- ChatMessage is 92 lines. That means it's rendering raw text with minimal formatting. No code block syntax highlighting, no copy buttons on code blocks, no collapsible long outputs.
- No message actions (copy, retry, edit, fork).
- No streaming token indicator — just a pulse dot.
- No avatar differentiation between user and AI.
- The "starters" (prompt suggestions) shown on empty state are the closest thing to an empty state, but they're likely just text buttons, not the welcoming experience users expect.

**Production quality looks like:** Claude.ai's message rendering — syntax-highlighted code blocks with copy button, thinking indicators with expandable reasoning, message-level actions on hover, avatar + model name on each AI message.

### WorkSurface.tsx (Grade: D+)

**What it is:** 378 lines. Side panel with timeline events, approvals, session signals, plus embedded RunPanel/UsageView/LedgerView/AdminView.

**Problems:**
- This component is trying to be 5 things at once: activity feed, approval queue, session monitor, run manager, usage dashboard, and admin view. All in a 320px panel. That's too much.
- Fixed width (w-80 = 320px). Not resizable. On a 1440px screen you get 320px for this and ~720px for chat after the sidebar. Cramped.
- "Session Signals" section shows Provider/Model/Latest in boxes. This is placeholder quality — it shows "Not routed yet" and "Pending" most of the time.
- The entire RunPanel, UsageView, LedgerView, and AdminView are stacked vertically inside this panel. Users have to scroll through ALL of them. No tabs, no collapsing, no organization.
- Mobile: slides up as a bottom sheet, which is acceptable but not ideal.

**Production quality looks like:** This should not exist as a single panel. These are separate views/pages. Cursor has a dedicated sidebar for file tree, a separate panel for terminal, and the chat is its own column. Don't stack everything.

### RunPanel.tsx — Ship Captain (Grade: C-)

**What it is:** 397 lines. Goal input, run creation, step display, PR creation, run history.

**Problems:**
- Ship Captain is buried INSIDE the WorkSurface panel, which is itself hidden behind a button. Your flagship feature is 2 clicks deep.
- The goal textarea is tiny (3 rows, inside a 320px panel). Writing complex multi-step goals in this is painful.
- Step display is a flat list with status badges. No tree view, no dependency visualization, no progress bar.
- "Worker status unknown" / "No worker progress yet" shows up most of the time. Not confidence-inspiring.
- "Create PR" button appears inline after a run. This should be more prominent — it's the payoff moment.
- Run history at the bottom is a simple list. No filtering, no grouping, no bulk actions.

**Production quality looks like:** Ship Captain deserves its own page. Think Vercel's deployment view: the goal is the hero, steps are a visual pipeline, each step expands to show logs/output, the PR creation is a celebration moment with confetti or at least a prominent success state.

### SettingsPanel.tsx (Grade: C)

**What it is:** 335 lines. Modal overlay with tabs.

**Problems:**
- It's a modal, not a page. Can't link to `/settings/billing`. Can't deep-link a user to their billing page.
- Tabs inside a modal feel cramped.
- Billing is a tab inside settings. It should be its own top-level section or at minimum a prominent settings category.

### Billing Components (Grade: B-)

**What it is:** PricingCards (just rebuilt), BillingPage, BillingHistory, PaymentFailed, TrialBanner.

**This is actually the best section.** The new PricingCards with promo code front-and-center is solid. BillingPage shows plan + referral + history. TrialBanner is correctly minimal.

**Remaining issues:**
- Still no Stripe integration working (502 error).
- No plan comparison table (what free vs pro includes).
- PaymentFailed is a full-screen takeover. Should allow users to still access their data while prompting for payment update.

### Auth/SignIn (Grade: B)

Using Clerk components directly. This is fine — don't rebuild auth UI.

---

## Part 3: Redesign Spec

### 3.1 — Layout Architecture

**Replace the current modal-driven layout with a proper router + persistent shell.**

```
┌─────────────────────────────────────────────────────────┐
│ TopBar: [≡] Cortex  [breadcrumb]           [⌘K] [⚙] [U]│
├───────┬─────────────────────────────────────┬───────────┤
│       │                                     │           │
│ Side  │          Content Area               │  Context  │
│  Nav  │                                     │  Panel    │
│       │   (Chat / Runs / Settings /         │ (optional │
│ 48-56 │    Admin / Billing)                 │  detail)  │
│  px   │                                     │           │
│       │                                     │  280-400  │
│ icons │          flex-1                     │  px       │
│ only  │                                     │ resizable │
│       │                                     │           │
├───────┴─────────────────────────────────────┴───────────┤
│ StatusBar: [provider] [model] [streaming...]    [⌘N ⌘K] │
└─────────────────────────────────────────────────────────┘
```

**Side Nav (48-56px, icon rail — like Linear/Slack):**
- Home (dashboard)
- Chat (conversations)
- Runs (Ship Captain)
- Settings
- Admin (conditional)
- User avatar at bottom

**Content Area:** Routes to the active page. Each page fills this space.

**Context Panel (optional, resizable):** Only appears when relevant:
- In Chat: shows active work events, approvals
- In Runs: shows step detail, logs
- Collapsible with drag handle or keyboard shortcut

### 3.2 — Routes

```
/                     → Home (dashboard)
/chat                 → New chat
/chat/:conversationId → Existing conversation
/runs                 → Ship Captain (run list + create)
/runs/:runId          → Run detail (steps, logs, PR)
/settings             → Settings (providers, preferences)
/settings/billing     → Billing & subscription
/settings/spend       → Usage & spend
/admin                → Admin panel (codes, users, stats)
```

### 3.3 — Home Page (What the user sees first)

**Not an empty chat. A dashboard.**

Layout (reference: Vercel Dashboard, Linear Home):
```
Welcome back, Josh.                    [New chat ⌘N]  [New run]

┌─ Active ────────────────────────────────────────────────┐
│  ● Run "fix auth + tests" — 3/5 steps done    [View →] │
│  ● Chat "billing webhook" — last msg 2m ago    [Open →] │
└─────────────────────────────────────────────────────────┘

┌─ Recent Conversations ──────────────────────────────────┐
│  ChatGPT-style list but with status indicators          │
│  [search ___________]                                   │
│  📌 Pinned: Cortex billing flow                        │
│  Today: 3 conversations                                 │
│  Yesterday: 5 conversations                             │
└─────────────────────────────────────────────────────────┘

┌─ Quick Actions ─────────┐  ┌─ System Status ───────────┐
│  [▶ New Run]             │  │  Provider: Claude ✓       │
│  [💬 New Chat]           │  │  Model: Opus 4.6          │
│  [⚙ Settings]           │  │  Plan: Pro (trial 5d)     │
│  [📊 Usage]              │  │  Usage: $2.30 today       │
└──────────────────────────┘  └───────────────────────────┘
```

**Why:** When you open Vercel, you see your deployments. When you open Linear, you see your issues. When you open Cortex... you should see your work. Not a blank chat prompt.

### 3.4 — Chat Page Redesign

**Like Claude.ai/Cursor, but with Cortex-specific features.**

Conversation list moves to a slide-over or the left portion of the content area (not the global sidebar).

Chat composer upgrades:
- Model selector chip (like Claude.ai's model dropdown)
- Context chips showing loaded repos/files
- `/run` slash command to create a Ship Captain run inline
- `@` mention for files from connected repos
- File attachment button
- Keyboard shortcut hints: "Enter to send, Shift+Enter for newline"

Message rendering upgrades:
- Syntax-highlighted code blocks with copy button + language label
- Collapsible long outputs (>20 lines collapsed by default)
- Message actions on hover: copy, retry, edit (for user messages)
- AI messages show model name + response time
- Approval cards render inline in the chat (they already do via ApprovalCard, good)

### 3.5 — Ship Captain Page (Dedicated)

**This is Cortex's differentiator. It needs its own page, not a sidebar section.**

Route: `/runs`

Layout:
```
Ship Captain                              [New Run ▶]

┌─ Active Run ────────────────────────────────────────┐
│  "Fix auth bug, add tests, prepare commit"          │
│                                                     │
│  ┌─Step 1──────┐  ┌─Step 2──────┐  ┌─Step 3──────┐ │
│  │ Analyze     │→ │ Fix auth    │→ │ Write tests │ │
│  │ ✓ Done      │  │ ● Running   │  │ ○ Pending   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                     │
│  Progress: ████████░░░░░░░░░ 2/5 steps              │
│  Worker: Claude Opus · Running 2m14s                 │
│                                                     │
│  [View Diff]  [Create PR]  [Cancel Run]             │
└─────────────────────────────────────────────────────┘

┌─ Run History ───────────────────────────────────────┐
│  [search ___________]  [filter: all ▾]              │
│  ✓ "Update nav + billing"  — 5 steps — 3m ago      │
│  ✓ "Refactor auth middleware" — 3 steps — 1h ago    │
│  ✗ "Deploy pipeline" — failed step 2 — 2h ago      │
└─────────────────────────────────────────────────────┘
```

The step visualization should be a horizontal pipeline (like GitHub Actions or Vercel build steps), not a vertical list. Each step expands on click to show logs/output.

### 3.6 — Command Palette (Cmd+K)

**Non-negotiable for developer tools.**

Actions available:
- New chat, New run
- Switch conversation (fuzzy search)
- Open run by name
- Go to settings, billing, admin
- Toggle context panel
- Change model
- Change run profile

Reference: Linear's command palette. Clean, fast, fuzzy-matched.

### 3.7 — Status Bar

**Bottom bar, always visible. Like VS Code's status bar.**

```
[Claude ✓] [Opus 4.6] [Pro · 5d trial]  ···  [⌘K Search] [⌘N New] [⌘J Panel]
```

Replace inline "Workspace connected" text with this.

### 3.8 — Toast System

Every action confirms: "Run created", "Conversation renamed", "Code applied", "PR created — view →". Use a toast stack (bottom-right or top-right). Reference: Vercel's toast system.

---

## Part 4: Priority List

### P0 — Without these it's not a product
1. **React Router with real URLs** — `/chat/:id`, `/runs/:id`, `/settings/billing`. Deep-linkable, refreshable.
2. **Command palette (Cmd+K)** — universal nav + actions.
3. **Home dashboard** — first thing users see. Active work, recent conversations, system status.
4. **Ship Captain as dedicated page** — pull out of WorkSurface into `/runs` with proper layout.
5. **Chat message rendering** — syntax highlighting, code copy, message actions.
6. **Status bar** — replace "Workspace connected" text.

### P1 — Makes it feel professional
7. **Side nav icon rail** — replace wide sidebar with 48px icon rail like Linear.
8. **Resizable panels** — chat + context panel with drag handle.
9. **Toast notifications** — action confirmations.
10. **Conversation search** — filter/search in conversation list.
11. **Chat composer upgrades** — model selector, keyboard hints, slash commands.
12. **Settings as page, not modal** — URL-routed.

### P2 — Polish
13. **Keyboard shortcuts with visual hints** — show ⌘N next to "New chat" button.
14. **Conversation pinning and folders** — organize work.
15. **Run step pipeline visualization** — horizontal steps like CI/CD.
16. **Empty states with illustrations** — welcoming first-time experience.
17. **Dark/light theme toggle** — currently hardcoded dark only.
18. **Animated transitions** — page transitions, panel slide, toast animations.

### P3 — Future (Orchestration Map)
19. **Live orchestration map** — real-time visualization of agent flow, model routing, token usage. This is a separate design exercise — needs its own research session. Think Datadog APM trace view meets GitHub Actions workflow graph.

---

## Summary Verdict

**Current state: Hackathon prototype with good bones.**

The backend integration is real (Clerk auth, Stripe billing, runs API, SSE streaming). The component code is clean TypeScript, well-structured, reasonable naming. The problem isn't code quality — it's product design. Everything is crammed into one view with no information hierarchy, no navigation structure, and no visual polish.

The single biggest change: **add a router and break the monolithic App.tsx into pages.** That one change forces every other improvement to follow naturally — because once you have `/runs` as a page, Ship Captain has room to breathe. Once you have `/` as a home page, you need a dashboard. Once you have URLs, you need proper navigation.

Cortex has a real backend, real auth, real billing, and a real orchestration engine. The frontend just needs to stop hiding all of that behind a single chat window.
