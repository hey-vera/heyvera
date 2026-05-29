# Cortex Frontend — Production Build Prompt (v2)

> Revised after GPT review. All backend contracts defined below.
> Target: cortex.heyvera.org — standalone Vite+React+Tailwind SPA.
> Must be production-ready for thousands of users.

---

## Context

Cortex is the AI orchestration brain of HeyVera. Users open one chat, talk naturally, and Cortex routes work across multiple AI providers (Claude, GPT, Gemini, etc.) without the user thinking about models, tiers, or workers.

**Stack:** Vite + React 19 + Tailwind CSS + TypeScript. Dark theme. Deployed at `cortex.heyvera.org`.

**Auth:** Clerk (already wired). Soma delegation protocol for cryptographic identity (already integrated — `useSomaSession.ts` handles session lifecycle, `cortexApi.ts` attaches tokens automatically).

**Backend API:** Rust (axum) at `:3001`. All endpoints in `cortex/src/lib/cortexApi.ts`. WebSocket at `/api/ws` (worker coordination) and `/api/mc` (Mission Control — real-time frontend observer feed).

---

## What Already Exists (Read Before Building)

**Read all existing files before writing anything. There is more built than you'd expect.**

### Core App
- `App.tsx` — Main shell. Auth gate → onboarding → chat. Session controls dials exist. Work surface panel on right.
- `types.ts` — All TypeScript interfaces including ChatSessionControls, RunProfile, WorkEventItem, ApprovalRequest.

### Chat
- `ChatComposer.tsx` — Text input with send/stop. Auto-resize textarea. **No image paste, no file attach, no autocomplete yet.**
- `ChatTimeline.tsx` — Message list with user/assistant bubbles.
- `ChatMessage.tsx` — Individual message rendering with provider/model labels.
- `ChatHeader.tsx` — Top bar.
- `ApprovalCard.tsx` — Inline diff approval cards.
- `ProviderSetup.tsx` — Provider auth setup flow.

### Session Controls
- `SessionControls.tsx` — **Already built and polished.** Three stepper dials (Speed, Intelligence, Autonomy) + Usage estimate badge + Run profile dropdown. These need to be WIRED to the backend (contract defined below).

### Work Surface (right panel)
- `WorkSurface.tsx` — Live session state panel. Timeline, approvals, session signals. Desktop: persistent sidebar. Mobile: slide-up drawer.
- `RunPanel.tsx` — Multi-step run management. Functional.
- `UsageView.tsx` — Token/cost usage display.
- `LedgerView.tsx` — Decision ledger.
- `AdminView.tsx` — Worker status, system stats.

### Sidebar
- `Sidebar.tsx` — Conversation list with search, pin, archive. Provider health. SomaIdentityBadge. Settings gear.
- `SomaIdentityBadge.tsx` — DID, delegation status, session expiry countdown.

### Onboarding
- `OnboardingFlow.tsx` — 3-step wizard (Providers → GitHub → Identity). Skeletal.
- `IdentityStep.tsx` — Stub, needs real substance.
- `CompleteStep.tsx` — Orphaned (removed from flow).

### Settings
- `SettingsPanel.tsx` — Modal with "Subscriptions" and "Soma spend" tabs.
- `SpendDashboard.tsx` — Per-delegation spend breakdown. View-only.

### Soma Integration
- `useSomaSession.ts` — Auto-creates/refreshes sessions. Sets global delegation.
- `useSomaSpend.ts` — Spend summary and per-delegation hooks.
- `cortexApi.ts` — Full API client. `revokeSomaDelegation()` exists but nothing calls it.

### Other
- `LiveFeed.tsx`, `CostGauge.tsx`, `PerformanceChart.tsx`, `RoutingIntel.tsx`, `ProviderHealth.tsx`, `ActiveRooms.tsx` — Various dashboard components.
- `ErrorBoundary.tsx` — React error boundary.

---

## Backend Contracts (Implemented)

These endpoints exist on the backend. Frontend must use these exact shapes.

### 1. Chat Request with Routing Preferences

```typescript
// POST /api/chat
interface ChatRequest {
  message: string;
  file_paths?: string[];
  conversation_id?: string;  // NEW: for multi-turn persistence
  routing_preferences?: RoutingPreferences;  // NEW: from session controls
}

interface RoutingPreferences {
  speed: 'steady' | 'balanced' | 'rapid';       // timeout/deadline behavior
  intelligence: 'focused' | 'balanced' | 'deep'; // model tier selection
  autonomy: 'manual' | 'guided' | 'smart_auto' | 'full_auto' | 'custom'; // approval flow
  profile?: 'auto' | 'balanced' | 'cost_saver' | 'quality_first';
  budget_limit?: number;  // per-request cap in credits (advisory)
}
```

Send these with every chat request. The backend uses `intelligence` to select model tier (focused=Haiku-class, balanced=Sonnet-class, deep=Opus-class) and `autonomy` to decide whether to ask for approval.

### 2. Route Request with Preferences

```typescript
// POST /api/route
interface RouteRequest {
  input: string;
  file_paths?: string[];
  routing_preferences?: RoutingPreferences;  // NEW
}
```

### 3. Chat Suggestions (Autocomplete)

```typescript
// GET /api/chat/suggestions
interface SuggestionsResponse {
  suggestions: Array<{
    text: string;       // "Fix the failing tests"
    category: string;   // "execute" | "search" | "think" | "setup" | "status"
    shortcut?: string;  // "fix" — tab completion trigger
  }>;
}
```

Frontend: Show suggestions as ghost text in ChatComposer or as a dropdown. Tab to accept. Fetch on focus or after idle period.

### 4. Chat Options (Response Buttons)

```typescript
// POST /api/chat/options
interface ChatOptionsRequest {
  assistant_message: string;
}

interface ChatOptionsResponse {
  options: Array<{
    label: string;    // "Fix the auth bug"
    value: string;    // what to send as next message
    category: string; // "option"
  }>;
}
```

Frontend: After receiving an assistant response that presents numbered choices, call this endpoint. Render options as clickable chips/buttons below the message. Clicking one sends `value` as the next user message.

### 5. Mission Control Snapshot

```typescript
// GET /api/mc/snapshot — Full system state for map initialization
interface McSnapshot {
  heart?: {
    did: string;
    heartbeat_count: number;
    head_hash: string;
    has_lineage: boolean;
    root_did?: string;
    capabilities: string[];
    revoked_count: number;
  };
  workers: Array<{
    worker_id: string;
    user_id: string;
    providers: string[];
    disabled_providers: string[];
  }>;
  active_runs: Array<{
    run_id: string;
    goal: string;
    status: string;
    step_count: number;
    steps_completed: number;
    steps_failed: number;
    created_at: string;
  }>;
  providers: Array<{
    id: string;
    label: string;
    authenticated: boolean;
    pressure: number;
    tiers: string[];
  }>;
  spend?: {
    total_spend: number;
    delegation_count: number;
    active_delegation_count: number;
  };
}
```

### 6. Mission Control WebSocket Protocol

```typescript
// WS /api/mc?token=<jwt>

// On connect, server sends:
{ type: "welcome", user_id: string, protocol: "mc/v1", events: string[] }

// Then server pushes delta events (defined below).
// Client is read-only — no messages to send (pings/pongs only).

// Delta event types:
type McEvent =
  | { type: "run_created"; run_id: string; goal: string; step_count: number }
  | { type: "step_dispatched"; run_id: string; step_id: string; provider: string; model: string; tier: string }
  | { type: "step_started"; run_id: string; step_id: string; provider: string; model: string }
  | { type: "step_output"; run_id: string; step_id: string; line: string }
  | { type: "step_completed"; run_id: string; step_id: string; exit_code: number; files_changed: string[]; cost_estimate?: number }
  | { type: "step_failed"; run_id: string; step_id: string; error: string; failure_kind: string }
  | { type: "run_completed"; run_id: string; status: string; total_cost?: number }
  | { type: "worker_connected"; worker_id: string; providers: string[] }
  | { type: "worker_disconnected"; worker_id: string }
  | { type: "routing_decision"; step_id: string; provider: string; model: string; rationale: string; pressure: number }
  | { type: "bandit_update"; provider: string; task_family: string; risk: string; trials: number; mean_reward: number; success: boolean };
```

**Node identity rules:**
- Heart: single node, ID = `heart`
- Workers: ID = `worker:{worker_id}` (stable across reconnects via same worker_id)
- Providers: ID = `provider:{id}` (e.g., `provider:claude`)
- Runs: ID = `run:{run_id}`
- Steps: ID = `step:{step_id}`

**Semantics:** Snapshot on connect (via `/api/mc/snapshot`), then apply deltas. On reconnect, re-fetch snapshot and re-apply. StepOutput is throttled server-side to max 1 per 500ms per step.

**Permission model:** Non-admin users see only their own runs/steps. Admin users see everything. The MC WebSocket filters events by authenticated user_id. Org-wide map should be gated behind admin check — show "limited view" for non-admins.

### 7. Budget Scope Enforcement

**What is enforced (backend):**
- Delegation-level Budget caveat — hard limit, server rejects requests when exceeded
- Session expiry (ExpiresAt caveat) — hard limit

**What is advisory (frontend-only for now):**
- Per-conversation budget (`routing_preferences.budget_limit`) — backend receives it but does not enforce yet
- Per-project budget — not implemented on backend
- Org/account budget — not implemented

**Frontend should:**
- Show Soma delegation budget + spend as the authoritative limit
- Show advisory per-conversation caps with clear "advisory" label
- Never imply enforcement that doesn't exist on the backend

### 8. Existing Soma API

```typescript
// Already in cortexApi.ts — wire these up:
createSomaSession(): Promise<SomaSession>      // POST /api/soma/session
getSomaMe(): Promise<SomaUserIdentity>          // GET /api/soma/me
getSomaSpend(): Promise<SomaSpendSummary>       // GET /api/soma/spend
getSomaDelegationSpend(id): Promise<...>         // GET /api/soma/spend/{id}
revokeSomaDelegation(id, did): Promise<...>      // POST /api/soma/revoke ← UNUSED, wire it up
getSomaIdentity(): Promise<SomaIdentity>        // GET /api/soma/identity (Cortex heart info)
```

---

## What Needs To Be Built

### Phase 1: Mission Control Foundation + Personal Map (Priority 1)

**This is the signature feature. Build it first.**

**Step 1: `useMissionControl` hook**
- Connect to `/api/mc?token=<jwt>` WebSocket
- On connect: fetch `/api/mc/snapshot` to get initial state
- Apply delta events to normalized state
- Handle reconnect: re-fetch snapshot, reapply
- Expose: `{ snapshot, events, connected, error }`
- Debounce state updates (batch events within 16ms frame)

**Step 2: Personal work map**
- Library: `@xyflow/react` (NOT old `reactflow` — check React 19 compatibility first)
- Show: user's active runs/steps, workers handling their work, providers being used
- Node types: RunNode, StepNode, WorkerNode, ProviderNode
- Edges: animated flow from run → step → worker → provider
- Color: green=healthy/succeeded, amber=running, red=failed, blue=dispatched
- Click any node → detail panel (side drawer or modal)
- Auto-layout via dagre/elk
- Minimap in corner

**Step 3: System map (admin-only)**
- Add HeartNode (center), all workers, all providers, all runs
- Delegation edges between heart and workers
- Gate behind admin check — non-admin sees "Your view" only
- Same interaction: click to inspect

### Phase 2: Chat Intelligence (Priority 1, parallel with Phase 1)

**Autocomplete suggestions:**
- Fetch `GET /api/chat/suggestions` on composer focus or after 500ms idle
- Show as ghost text (greyed out) that Tab accepts
- Or show as dropdown below composer with category icons
- Keyboard: Tab to accept top suggestion, arrow keys to navigate, Escape to dismiss

**Response options:**
- After each assistant message, call `POST /api/chat/options`
- If options returned, render as clickable chip buttons below the message
- Clicking a chip sends its `value` as the next user message
- Style: rounded pills with category-appropriate colors

**Wire session controls to backend:**
- When sending chat/route requests, include `routing_preferences` from SessionControls state
- The controls already exist and look great — just send them in the request payload
- Update the disclaimer text from "backend limits are not wired" to show actual effect

**Markdown rendering:**
- Use `react-markdown` + `remark-gfm` + `react-syntax-highlighter`
- Code blocks: syntax highlighting + copy button
- Tables, lists, links render properly
- LaTeX: optional, skip for v1 if complex

### Phase 3: Chat Attachments (Priority 2)

**Image paste:**
- Handle `onPaste` in ChatComposer — read `clipboardData.items` for images
- Show thumbnail preview below textarea before sending
- For v1: send as base64 BUT enforce client-side size limit (max 2MB per image, max 4 images)
- Show error toast if over limit
- Backend does NOT have upload endpoint yet — gate with a "max 2MB" client check
- When backend adds object storage, switch to upload URL flow

**File attachment:**
- Paperclip button in composer
- Accept: images, text files, code files
- Show as pills/chips below textarea
- Same size limit as images
- Drag-and-drop onto chat area

### Phase 4: Notifications & Error Surfacing (Priority 2)

**Toast system:**
- Use `sonner` (modern, React 19 compatible, minimal)
- Toast on: task complete, task failed, approval needed, session expiring (15 min), budget warning (80%), provider error
- Error toasts: expandable detail
- Session refresh failures should show toast, not fail silently

**Notification bell (ChatHeader):**
- Unread count badge
- Dropdown with recent notifications
- Click to navigate
- Types: approval needed, run complete, run failed, budget warning

### Phase 5: Onboarding Rewrite (Priority 2)

**5 steps:**
1. **Welcome** — value prop, user's Clerk profile, "Let's set you up"
2. **Connect Providers** — existing ProviderStep, polished. At least one required.
3. **Link GitHub** (skippable) — existing GitHubStep, polished
4. **Your Identity** — explain Soma in simple terms, show DID creation, show delegation issued
5. **Ready** — summary of what's connected, quick tips, "Start building"

Remove orphaned `CompleteStep.tsx`.

### Phase 6: Settings Expansion (Priority 3, PR-sized slices)

**Slice A: Settings shell + profile**
- Tabbed settings modal with proper IA
- Profile section: avatar, name, email, Soma DID (read-only, copy button)

**Slice B: Provider management**
- Enhanced provider connections with status indicators
- Add/remove provider connections
- Both subscription auth AND API key input (password field with show/hide)
- API keys sent to backend only, never stored in localStorage

**Slice C: Delegation inspector**
- List active delegations with: ID, issuer→subject, capabilities, caveats, expiry countdown
- "Revoke" button → confirm dialog → calls `revokeSomaDelegation()`
- Show revocation success/failure toast

**Slice D: Notification preferences** (deferred until backend endpoint exists)

### Phase 7: Spend Visualization (Priority 3)

- Time-series spend chart (use `recharts`)
- Per-capability and per-provider breakdown
- Budget progress bar near SomaIdentityBadge in sidebar
- Warning at 80% delegation budget, banner at 90%
- Daily/weekly views

---

## Technical Requirements

**Dependencies to add:**
- `@xyflow/react` — live orchestration map (verify React 19 support first)
- `recharts` — spend/usage charts
- `sonner` — toast notifications
- `react-markdown` + `remark-gfm` + `react-syntax-highlighter` — markdown rendering
- `date-fns` — date formatting

**Do NOT add:** Redux/Zustand (React state + context is fine), CSS-in-JS (Tailwind is the design system), mock data files (use real API).

**Performance:**
- Lazy load: map, charts, admin views, settings modal
- Virtual scroll for long conversation lists
- Debounce WebSocket updates (16ms batching)
- Memoize expensive computations

**Test harness:** Add Vitest + React Testing Library to `cortex/package.json` before writing tests. Tests are required for: auth gate, chat send/receive, MC WebSocket reconnect, delegation revocation flow.

---

## Quality Bar

- No placeholder text ("Coming soon", "TODO")
- No console.log statements
- Every loading state: skeleton loader (not spinner) for content areas
- Every error state: message + recovery action
- Every button: hover/active/disabled visual feedback
- Keyboard navigation: Tab, Enter, Escape
- Accessible: aria-labels on all interactive elements
- Mobile responsive: test at 375px width
- Performance: FCP < 1.5s, no scroll/type jank

---

## Design System (existing, maintain)

- Background: `var(--panel)` (dark charcoal)
- Text: white for primary, `var(--muted)` for secondary, `var(--muted-strong)` for tertiary
- Accent: `var(--accent)` (teal/emerald)
- Borders: `white/6` to `white/10`
- Corners: `rounded-xl` for cards, `rounded-2xl` for panels, `rounded-full` for pills
- Composer: `var(--composer)` background
- Transitions on all state changes
- No layout jumps

---

## Implementation Order

1. **MC foundation**: `useMissionControl` hook + types + snapshot fetch
2. **Personal map v1**: @xyflow/react, real data, read-only
3. **Chat autocomplete**: suggestions endpoint + ghost text/dropdown
4. **Chat response options**: clickable chips from assistant responses
5. **Wire session controls**: send `routing_preferences` with requests
6. **Markdown rendering**: react-markdown in ChatMessage
7. **Notifications/toasts**: sonner, session warnings, error surfacing
8. **Onboarding rewrite**: 5-step flow
9. **Settings shell + profile**: tabbed modal
10. **Provider management**: enhanced connections
11. **Delegation inspector**: view + revoke
12. **System map (admin)**: org-wide view
13. **Spend charts**: recharts time-series
14. **Image paste**: with client-side size limits
15. **Budget indicators**: sidebar progress bar, warnings

---

## What NOT To Do

- Don't rewrite working components from scratch — enhance what exists
- Don't add state management libraries — React state + context
- Don't create mock data — use real API, handle loading/error
- Don't imply backend enforcement that doesn't exist (budget scopes)
- Don't build notification preferences UI until backend endpoint exists
- Don't build delete account, API key storage, or Slack integration — no backend support yet
- Don't over-abstract — product, not component library

---

## Backend API Reference

All in `cortex/src/lib/cortexApi.ts`. Key additions since v1 prompt:

```
NEW: GET  /api/chat/suggestions     — contextual autocomplete
NEW: POST /api/chat/options          — extract clickable options from response
NEW: GET  /api/mc/snapshot           — full system state for map init
UPD: POST /api/chat                  — now accepts conversation_id + routing_preferences
UPD: POST /api/route                 — now accepts routing_preferences
```

Existing endpoints unchanged — see cortexApi.ts for full list.
