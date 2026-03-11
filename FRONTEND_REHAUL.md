# ClawNet Frontend Rehaul — Master Architecture Document

> **Purpose:** Complete visual and structural overhaul of every HTML page in `site/`. This document is the single source of truth for Sonnet executing the work chunk by chunk.

---

## Design Philosophy

**Target audience:** Professional developers, AI/ML engineers, crypto builders. These people use Stripe, Vercel, Linear, Raycast — clean, information-dense, no gimmicks.

**What we're moving away from:** Neon green hacker aesthetic, terminal gimmicks, noise textures, crypto-bro energy, inconsistent fonts across pages.

**What we're moving toward:** The design language of Linear, Vercel, and Stripe's dashboard — muted dark theme, restrained color, excellent typography, dense but readable data, surgical use of accent color.

---

## 1. Design System (shared across ALL pages)

### 1.1 Color Palette

```css
:root {
  /* Backgrounds */
  --bg-primary: #0a0a0b;       /* page background */
  --bg-surface: #111113;       /* cards, panels */
  --bg-surface-2: #18181b;     /* elevated cards, hover states */
  --bg-surface-3: #1f1f23;     /* active states, selected items */
  --bg-overlay: rgba(0,0,0,0.80);

  /* Borders */
  --border-subtle: #1e1e22;    /* card borders */
  --border-default: #27272a;   /* input borders */
  --border-strong: #3f3f46;    /* active/focus borders */

  /* Text */
  --text-primary: #fafafa;     /* headings, emphasis */
  --text-secondary: #a1a1aa;   /* body text */
  --text-tertiary: #71717a;    /* labels, captions */
  --text-muted: #52525b;       /* disabled, placeholder */

  /* Accent — single accent: a professional teal-green (NOT neon) */
  --accent: #10b981;           /* primary actions, links, success */
  --accent-dim: rgba(16,185,129,0.12);
  --accent-subtle: rgba(16,185,129,0.06);
  --accent-hover: #34d399;
  --accent-text: #6ee7b7;

  /* Semantic */
  --danger: #ef4444;
  --danger-dim: rgba(239,68,68,0.12);
  --warning: #f59e0b;
  --warning-dim: rgba(245,158,11,0.12);
  --info: #3b82f6;
  --info-dim: rgba(59,130,246,0.12);
  --purple: #8b5cf6;           /* crypto/USDC accent */
  --purple-dim: rgba(139,92,246,0.12);

  /* Spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
  --font-display: 'Inter', -apple-system, system-ui, sans-serif;

  /* Font sizes */
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 18px;
  --text-2xl: 22px;
  --text-3xl: 28px;
  --text-4xl: 36px;
  --text-5xl: 48px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
  --shadow-glow: 0 0 20px rgba(16,185,129,0.08);
}
```

### 1.2 Typography Rules

- **Page titles:** `var(--font-display)`, 28-36px, weight 600, `--text-primary`, letter-spacing: -0.02em
- **Section headings:** `var(--font-sans)`, 18-22px, weight 600, `--text-primary`
- **Card headings:** `var(--font-sans)`, 14-16px, weight 600, `--text-primary`
- **Body text:** `var(--font-sans)`, 14px, weight 400, `--text-secondary`, line-height 1.6
- **Labels/captions:** `var(--font-sans)`, 11-12px, weight 500, `--text-tertiary`, letter-spacing 0.02em, uppercase
- **Code/data values:** `var(--font-mono)`, 13px, weight 400
- **Stat numbers:** `var(--font-mono)`, 24-32px, weight 700, `--accent` or `--text-primary`

**NO IBM Plex Serif anywhere.** No display serif. This is a developer tool, not a newspaper.

### 1.3 Component Library

All pages must use these exact component patterns:

#### Buttons
```css
/* Primary */
.btn { font-family: var(--font-sans); font-size: 13px; font-weight: 500; padding: 8px 16px; border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s; border: 1px solid transparent; }
.btn-primary { background: var(--accent); color: #000; border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-hover); }

/* Ghost */
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-default); }
.btn-ghost:hover { border-color: var(--border-strong); color: var(--text-primary); background: var(--bg-surface-2); }

/* Danger */
.btn-danger { background: transparent; color: var(--danger); border: 1px solid rgba(239,68,68,0.3); }
.btn-danger:hover { background: var(--danger-dim); border-color: var(--danger); }

/* Purple (crypto) */
.btn-purple { background: var(--purple-dim); color: var(--purple); border: 1px solid rgba(139,92,246,0.3); }
.btn-purple:hover { background: rgba(139,92,246,0.2); border-color: var(--purple); }
```

#### Cards
```css
.card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-6); }
.card:hover { border-color: var(--border-default); }
```

#### Inputs
```css
.input { font-family: var(--font-sans); font-size: 13px; background: var(--bg-primary); border: 1px solid var(--border-default); color: var(--text-primary); padding: 8px 12px; border-radius: var(--radius-md); outline: none; transition: border-color 0.15s; }
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
.input::placeholder { color: var(--text-muted); }
```

#### Badges
```css
.badge { font-family: var(--font-sans); font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; }
.badge-success { background: var(--accent-dim); color: var(--accent); }
.badge-danger { background: var(--danger-dim); color: var(--danger); }
.badge-warning { background: var(--warning-dim); color: var(--warning); }
.badge-info { background: var(--info-dim); color: var(--info); }
.badge-neutral { background: rgba(113,113,122,0.15); color: var(--text-tertiary); }
```

#### Stat Cards
```css
.stat-card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-5); }
.stat-value { font-family: var(--font-mono); font-size: 28px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; }
.stat-label { font-size: 12px; font-weight: 500; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
```

#### Tables
```css
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { font-size: 11px; font-weight: 500; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; text-align: left; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); }
.table td { padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
.table tr:hover td { background: var(--bg-surface-2); }
```

### 1.4 Navigation (consistent across ALL pages)

```
[Logo]  Home  Docs  Marketplace  Endpoints  Dashboard   [API Status: Operational]  [Credits: 4,200]  [Sign In / Sign Out]
```

- Sticky top, 56px height, `backdrop-filter: blur(12px)`
- Background: `rgba(10,10,11,0.95)`, bottom border: `var(--border-subtle)`
- Logo: `site/logo.png`, max-height 36px
- Links: `var(--font-sans)`, 13px, weight 500, `--text-tertiary`, hover → `--text-primary`
- Active link: `--text-primary` with 2px bottom border `--accent`
- API status indicator: small dot (green=ok, red=error) + "Operational" text
- Credits badge: shows credit count when logged in
- **Nav must be identical on every page** (copy/paste the exact same HTML structure)

### 1.5 Footer (consistent across ALL pages)

```
[Logo]   Home  Docs  Marketplace  Endpoints  Dashboard     (c) 2024 ClawNet
         GitHub  Telegram  Contact
```

Simple, single-line footer. No decoration. `--text-tertiary` color. Border-top `var(--border-subtle)`. Padding 32px. `var(--font-sans)`, 12px.

### 1.6 Remove Everywhere

- Grid background overlay (`body::before` with grid lines)
- Noise texture overlay
- `@keyframes pulse` on dots (replace with static colored dots)
- IBM Plex Serif font
- Space Mono font (replace with JetBrains Mono for code only)
- Neon green (#00ff88) — replace ALL with `--accent` (#10b981)
- Terminal/hacker animations
- Excessive letter-spacing (max 0.04em on labels)
- ALL-CAPS on anything except tiny labels
- The `<div class="grid-bg">` element

---

## 2. Page-by-Page Specifications

### 2.1 Landing Page (`index.html`)

**Role:** Convert visitors into sign-ups. Professional, concise, credible.

**Structure:**
1. **Nav** (shared)
2. **Hero** — clean, no terminal animation
   - Eyebrow: `UNIVERSAL API ORCHESTRATION` (small, `--text-tertiary`)
   - H1: "One query. Any API.\nOne intelligent answer." (36-48px, `--text-primary`, weight 600)
   - Subtitle: 1-2 sentences, 16px, `--text-secondary`
   - CTA row: `[Get API Key]` (primary) + `[View Docs]` (ghost) + `[Try on Telegram]` (ghost, small)
   - Below CTAs: live stats row — `158 endpoints`, `12 providers`, `99.8% uptime` — fetched from `GET /v1/stats`
3. **How It Works** — 3-step pipeline (horizontal cards, not the current terminal-like boxes)
   - Step 1: "Query" — natural language in
   - Step 2: "Orchestrate" — parallel API execution
   - Step 3: "Answer" — synthesized response
   - Each step: icon (simple SVG or emoji), title, 1-line description
4. **API Example** — side-by-side: curl request (left) + JSON response (right). Clean code blocks with syntax highlighting via CSS classes. No terminal chrome (no red/yellow/green dots).
5. **Data Sources** — grid of provider cards (Birdeye, Helius, Jupiter, etc.) showing endpoint count and status dot
6. **Pricing** — 6 credit packages ($5–$1000) in a clean grid
   - Each card: price, credits, per-query estimate, features list, buy button
   - Featured card: subtle accent border, not a neon glow
   - Below grid: USDC alternative section with Solana wallet button (purple accent, subtle)
7. **Balance Checker** — input field + button to check credit balance by API key
8. **Contact Section** — form (name, email, subject, message)
9. **Footer** (shared)

**Live data to fetch:**
- `GET /v1/stats` → total calls, success rate, active endpoints
- `GET /health` → API status dot in nav
- Credit balance checker → `GET /v1/dashboard/me` (if logged in)

**Kill list for index.html:**
- Terminal animation with typing cursor
- Grid background overlay
- Noise texture
- The announcement bar at the very top
- The "hero-users-stat" box (replace with inline stats)
- `--display: 'IBM Plex Serif'`

---

### 2.2 Dashboard (`dashboard.html`)

**Role:** API key management, credit balance, usage overview, quick actions.

**Structure:**
1. **Nav** (shared, credits badge visible)
2. **Page Header** — "Dashboard" title + user email
3. **Stats Grid** (3 columns) — fetched from `GET /v1/auth/usage`
   - Credits remaining (large number, accent color)
   - Credits used (total lifetime)
   - Amount paid (USD)
4. **API Key Card**
   - Masked key display: `cn-a1b2••••••••c3d4`
   - Buttons: `[Reveal Key]` `[Copy]` `[Regenerate]`
   - Reveal opens a modal with full key + copy button + warning ("Store securely. Shown once.")
   - Regenerate: confirmation dialog → calls `POST /v1/dashboard/regenerate-key`
5. **Quick Start** — collapsible card with curl example using the user's masked key
6. **Top Up Credits** — 3x2 grid of credit packages (same data as pricing on index.html)
   - Each card: amount, credits, buy button → Stripe checkout
   - Below: USDC alternative (purple accent button)
7. **Task History** — **NEW SECTION** — fetched from `GET /v1/tasks?limit=10`
   - Table with columns: Task ID (truncated), Skill, Status (badge), Credits, Duration, Created
   - Status badges: COMPLETED (green), FAILED (red), RUNNING (blue pulse), PENDING (gray), CANCELLED (yellow)
   - Click row → navigate to task detail (could be a modal or expand)
   - "View All" link → could go to a `/tasks` hash route or just load more
8. **Usage Breakdown** — simple bar or stat cards showing:
   - Tasks: total / completed / failed (from `GET /v1/auth/usage`)
   - Marketplace: purchases / credits spent
9. **Claim Credits** — input for Stripe session ID or email claim
10. **Danger Zone** — regenerate key button with red border
11. **Footer** (shared)

**Live data to fetch:**
- `GET /v1/dashboard/me` → key info, credits, email
- `GET /v1/auth/usage` → task stats, marketplace stats
- `GET /v1/tasks?limit=10` → recent tasks
- `GET /health` → API status
- `GET /v1/stats` → network stats bar (optional, at top)

**Kill list for dashboard.html:**
- The current "network stats bar" (too noisy for a dashboard)
- JetBrains Mono as the body font (use Inter; JetBrains Mono only for code/numbers)

---

### 2.3 Marketplace (`marketplace.html`)

**Role:** Browse, purchase, publish, and manage skills. This is the most complex page.

**Structure:**
1. **Nav** (shared)
2. **Hero Section** — compact header with marketplace title + live stats
   - Title: "Skill Marketplace"
   - Stats: `{N} skills` `{N} total purchases` `{N} creators` — from `GET /v1/stats` or `GET /v1/marketplace/skills?limit=1` (total count)
3. **Tab Bar** — `Browse` | `My Skills` | `Publish` | `Starred` | `Task History` | `How It Works`
   - **NEW TAB: "Task History"** — shows task results from `GET /v1/tasks`
4. **Browse Tab:**
   - Controls: search input + category filter dropdown + sort dropdown (Popular, Newest, Price Low/High, Stars)
   - Category pills: All, DeFi, Security, Social, AI, Search, Media, etc. (fetched dynamically or hardcoded from known categories)
   - Skill cards grid (2-3 columns):
     - Card layout:
       ```
       [Category badge]                    [Security badge]
       Skill Name                          5 cr
       skill-slug                          per call
       Description text (2 lines max)...

       [tags] [tags]

       Invocations: 1,204  Stars: 42  Success: 98%

       [Purchase & Run]  [View Details]  [Star]
       ```
     - Official skills get a subtle `OFFICIAL` badge (not garish)
     - VERIFIED skills get a green checkmark badge
     - Prices: `{N} cr` in accent color
   - Pagination: `< 1 2 3 ... 10 >`
5. **Skill Detail View** (shown when clicking a skill):
   - Back button
   - Title + slug + author + version + security status
   - Meta grid: Price, Invocations, Stars, Success Rate, Category, License
   - Sub-tabs: Overview | Schema | Metrics | History
     - **Overview:** Description, readme (if any), cost breakdown table, invoke section
     - **Schema:** Input/output JSON schemas (formatted code blocks)
     - **Metrics:** Performance data from `GET /v1/skills/:id/metrics`
     - **History:** Version changelog from `GET /v1/marketplace/skills/:id/versions`
   - **Cost Estimation** — **NEW** — before purchase, call `GET /v1/auth/estimate?skillId=X` and show "Estimated cost: 5 credits" + "You can afford this" / "Insufficient credits"
   - Purchase button: calls `POST /v1/marketplace/skills/:id/purchase`
   - After purchase: show result inline, offer rating (1-5 stars)
   - Report button (small, in footer of detail view)
6. **My Skills Tab:**
   - Creator stats: total earned, total sales, published skills count
   - List of own skills with: name, status (live/draft), invocations, earned credits, actions (edit visibility, delete)
   - Withdraw button → USDC payout request form
7. **Publish Tab:**
   - Form: name (slug), display name, category, description, prompt template, credit cost, version, tags, skill type (prompt/api_proxy), proxy URL (if api_proxy)
   - Live validation sidebar: character counts, variable preview, schema check
   - Submit → `POST /v1/skills`
8. **Starred Tab:**
   - Grid of starred skills (client-side filter or dedicated endpoint)
9. **Task History Tab** — **NEW:**
   - Table: Task ID, Skill Name, Status, Credits Used, Duration, Created, Rating
   - Expandable rows showing full result JSON
   - Rate button on completed tasks → `POST /v1/tasks/:id/rate`
   - Cancel button on pending tasks → `POST /v1/tasks/:id/cancel`
   - Pagination
10. **How It Works Tab:**
    - Economy explainer: 97% creator share, 3% platform fee
    - Skill types: prompt template vs API proxy
    - Staking explanation
    - Getting started steps
11. **Footer** (shared)

**Live data to fetch:**
- `GET /v1/marketplace/skills` — browse catalog (paginated)
- `GET /v1/marketplace/skills/:id` — skill detail
- `GET /v1/marketplace/skills/:id/versions` — version history
- `GET /v1/marketplace/search?q=` — search
- `GET /v1/auth/estimate?skillId=` — cost preview **NEW**
- `GET /v1/auth/me` — credits/balance for "can afford" check **NEW**
- `GET /v1/auth/usage` — usage stats **NEW**
- `GET /v1/tasks` — task history **NEW**
- `GET /v1/tasks/:id` — task detail **NEW**
- `POST /v1/tasks/:id/rate` — rating **NEW**
- `POST /v1/tasks/:id/cancel` — cancel **NEW**
- `POST /v1/marketplace/skills/:id/purchase` — buy + execute
- `POST /v1/skills` — publish
- `GET /v1/skills/mine` — my skills
- `GET /v1/marketplace/creator/stats` — creator earnings
- `POST /v1/marketplace/stake` / `POST /v1/marketplace/unstake/:id` — staking
- `GET /v1/marketplace/transactions` — transaction history
- `GET /health` — API status

---

### 2.4 Docs (`docs.html`)

**Role:** Complete API reference for developers.

**Structure:**
1. **Nav** (shared)
2. **Sidebar** (fixed left, 240px) — table of contents with all endpoint groups:
   - Authentication
   - Orchestration
   - Skills
   - Tasks (NEW)
   - Marketplace
   - Auth & Credits (NEW)
   - Discovery
   - Escrow
   - Governance
   - Registry
   - LLM Proxy
   - Streaming
   - Batch
   - Mesh
   - Admin
3. **Main content** (right of sidebar) — each endpoint group:
   - Group header with description
   - For each endpoint: method badge (GET=blue, POST=green, DELETE=red, PATCH=yellow), path, description, auth requirement, parameters table, example request (curl), example response (JSON)
   - Code blocks: dark background, monospace, with copy button
4. **Footer** (shared)

**New endpoint groups to document:**
- **Tasks API:**
  - `POST /v1/tasks` — submit task (skillId, variables, idempotencyKey, webhookUrl)
  - `GET /v1/tasks` — list tasks (limit, offset)
  - `GET /v1/tasks/:id` — task detail
  - `POST /v1/tasks/:id/cancel` — cancel pending
  - `POST /v1/tasks/:id/rate` — rate completed (1-5)
- **Auth API:**
  - `GET /v1/auth/me` — current key info
  - `GET /v1/auth/estimate?skillId=` — cost estimate
  - `GET /v1/auth/usage` — usage summary

**Style:** Clean like Stripe's API docs. Left sidebar scrolls independently. Content area has generous whitespace. Syntax highlighting via CSS classes (no JS library needed).

---

### 2.5 Endpoints (`endpoints.html`)

**Role:** Live catalog of all 158+ API endpoints the platform can call.

**Structure:**
1. **Nav** (shared)
2. **Header** — "API Endpoints" title + total count + health summary
3. **Controls** — search + category filter + status filter (All/Operational/Degraded/Down)
4. **Endpoint Grid** — cards showing:
   - Endpoint name + provider
   - Category badge
   - Status indicator (green/yellow/red dot + text)
   - Latency (avg ms)
   - Uptime %
   - Credit cost
5. **Footer** (shared)

**Data:** `GET /v1/endpoints` + `GET /v1/registry/health`

---

### 2.6 Login (`login.html`)

**Role:** Clerk-powered authentication.

**Structure:**
1. **Nav** (shared, minimal — no links except logo)
2. **Centered card** (max-width 400px):
   - "Sign in to ClawNet" heading
   - Clerk sign-in widget (via `<div id="clerk-sign-in">`)
   - Below: "New here?" link to sign-up
3. **Footer** (minimal)

**Style:** Very clean. No split-panel. No feature list on the side (that's marketing, not auth). Just the sign-in form centered on the page.

---

### 2.7 Success (`success.html`)

**Role:** Post-purchase confirmation showing API key.

**Structure:**
1. **Nav** (shared)
2. **Centered card** (max-width 520px):
   - Success icon (green checkmark)
   - "Payment Successful" heading
   - API key display with copy button
   - Credit amount received
   - Quick-start curl example
   - "Go to Dashboard" button
3. **Footer** (shared)

---

### 2.8 Admin (`admin.html`)

**Role:** Internal admin dashboard (behind admin key).

**Structure:**
1. **Nav** (shared, admin label visible)
2. **Stats grid** — total revenue, active users, pending payouts, open disputes
3. **Sections:**
   - Top queries (table)
   - Circuit breaker status (table with status badges)
   - Feedback summary
   - Payout queue
   - Key revocation form
4. **Footer** (shared)

**Data:** `GET /v1/admin/dashboard` + `GET /v1/admin/payouts` + `GET /v1/admin/revenue` + `GET /v1/admin/treasury`

---

### 2.9 Contact Section (`contact-section.html`)

**Role:** Reusable contact form partial.

Simplify to: name, email, subject dropdown, message textarea, submit button. Honeypot field hidden. Clean styling matching the design system. No changes to form logic, just CSS alignment.

---

## 3. Live Data Patterns

### 3.1 Polling Strategy

All live-updating numbers should use this pattern:

```javascript
// Fetch and update on page load
async function refreshStats() {
  try {
    const res = await fetch('/v1/stats');
    if (!res.ok) return;
    const data = await res.json();
    // Update DOM elements
    document.getElementById('stat-calls').textContent = data.totalCalls.toLocaleString();
    document.getElementById('stat-success').textContent = data.successRate + '%';
    // etc.
  } catch { /* silent fail on stats refresh */ }
}

// Initial load + poll every 30 seconds
refreshStats();
setInterval(refreshStats, 30000);
```

### 3.2 Number Formatting

- Credits: `toLocaleString()` — `4,200` not `4200`
- Percentages: one decimal — `98.7%`
- Durations: `1.2s` or `340ms`
- USD: `$20.00`
- Timestamps: relative — "2 hours ago", "3 days ago" (use a simple `timeAgo()` helper)

### 3.3 API Status Indicator

Every page has this in the nav:
```javascript
async function checkHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    dot.className = 'status-dot ' + (data.status === 'ok' ? 'ok' : data.status === 'degraded' ? 'warn' : 'err');
    label.textContent = data.status === 'ok' ? 'Operational' : data.status === 'degraded' ? 'Degraded' : 'Down';
  } catch {
    // assume down
  }
}
checkHealth();
setInterval(checkHealth, 60000);
```

### 3.4 Auth State (Clerk)

Every page with Clerk integration:
```javascript
// After Clerk loads
async function onClerkReady() {
  const session = window.Clerk?.session;
  if (session) {
    // Show logged-in state: credits badge, email, sign-out button
    // Hide: sign-in button, get API key CTA
    const token = await session.getToken();
    const res = await fetch('/v1/dashboard/me', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      // Update nav credits badge
      document.getElementById('navCredits').textContent = data.credits.toLocaleString();
      document.getElementById('navEmail').textContent = data.email;
      // Show/hide appropriate nav elements
    }
  }
}
```

---

## 4. Implementation Chunks

Execute these in order. Each chunk is independently deployable.

### Chunk 1: Design System + Nav + Footer
- Create a shared CSS block (copy into each HTML file since these are standalone files, not a build system)
- Implement the nav HTML/CSS/JS (identical on every page)
- Implement the footer HTML/CSS
- Apply to a blank template page to verify

### Chunk 2: Landing Page (`index.html`)
- Complete rewrite with new design system
- Hero section (no terminal animation)
- Pipeline steps
- API example (clean code blocks)
- Pricing grid
- USDC modal
- Balance checker
- Contact form
- Wire up: `GET /v1/stats`, `GET /health`, Clerk auth state

### Chunk 3: Dashboard (`dashboard.html`)
- Complete rewrite
- Stats grid (credits, usage, amount paid)
- API key card with reveal/regenerate
- Top-up grid
- Task history table (NEW — `GET /v1/tasks`)
- Usage breakdown (NEW — `GET /v1/auth/usage`)
- Claim section
- Wire up all dashboard API calls

### Chunk 4: Marketplace (`marketplace.html`)
- Complete rewrite (largest page)
- Tab system (Browse, My Skills, Publish, Starred, Task History, How It Works)
- Browse: search, filters, skill cards, pagination
- Skill detail view with sub-tabs
- Cost estimation before purchase (NEW)
- Task history tab (NEW)
- Rating on completed tasks (NEW)
- My Skills tab with creator stats
- Publish form
- Wire up all marketplace + task + auth API calls

### Chunk 5: Docs (`docs.html`)
- Complete rewrite
- Sidebar navigation
- All endpoint groups documented
- New endpoint groups: Tasks API, Auth API
- Code examples with copy buttons
- Clean syntax highlighting

### Chunk 6: Supporting Pages
- `endpoints.html` — rewrite with new design system
- `login.html` — simplify to centered Clerk widget
- `success.html` — rewrite with new design system
- `admin.html` — rewrite with new design system
- `contact-section.html` — align CSS with design system

---

## 5. Critical Implementation Notes

### 5.1 File Structure
All files live in `site/`. They are standalone HTML files (no build system). CSS is inlined in `<style>` tags. JS is inlined in `<script>` tags. This is by design — they're served as static files from `/var/www/claw-net/` on the VPS.

### 5.2 Shared CSS
Since there's no build system, the design system CSS variables and base component styles must be duplicated in each HTML file's `<style>` block. This is acceptable — the alternative (a shared .css file) would require Caddy config changes.

### 5.3 External Dependencies
- **Clerk:** `<script src="https://cdn.clerk.dev/...">` — keep existing integration pattern
- **Fonts:** Google Fonts — `Inter` (weights 400, 500, 600, 700) + `JetBrains Mono` (weights 400, 700)
- **No other JS libraries.** All interactivity is vanilla JS with `fetch()`.

### 5.4 API Base URL
All API calls use relative paths (`/v1/...`, `/health`). The HTML files are served from the same domain via Caddy reverse proxy.

### 5.5 Responsive Breakpoints
- Desktop: > 1024px
- Tablet: 768px–1024px
- Mobile: < 768px
- Nav collapses to hamburger menu on mobile
- Grids reduce columns
- Sidebar (docs) becomes a top dropdown on mobile

### 5.6 Clerk Integration
- Clerk publishable key is loaded from a `<script>` tag
- Auth state determines: nav buttons shown, credits displayed, dashboard access
- Login page uses Clerk's pre-built sign-in component
- Dashboard pages use `Clerk.session.getToken()` for authenticated API calls
- The existing Clerk setup must be preserved exactly — just restyle the surrounding UI

### 5.7 Stripe Integration
- Pricing buttons link to Stripe Checkout URLs (server-generated)
- USDC modal handles Phantom wallet connection
- Success page reads `session_id` from URL params
- The existing payment flow logic must be preserved — just restyle

### 5.8 What NOT to Change
- Any existing JavaScript business logic (Stripe checkout, Clerk auth, USDC payment, form submission handlers)
- API endpoint paths
- Clerk/Stripe configuration
- The actual data flow — only the visual presentation changes

---

## 6. Quality Checklist (verify after each chunk)

- [ ] All pages use identical nav and footer
- [ ] No neon green (#00ff88) anywhere — only #10b981
- [ ] No IBM Plex Serif or Space Mono fonts
- [ ] No grid-bg overlay or noise texture
- [ ] No terminal/hacker animations
- [ ] All number displays use `toLocaleString()`
- [ ] API status indicator in nav works (polls /health)
- [ ] Credits badge shows in nav when logged in
- [ ] All buttons have hover states
- [ ] All inputs have focus states with accent color ring
- [ ] Cards have subtle hover border change
- [ ] Font sizes are consistent (not a mix of px values)
- [ ] Mobile responsive (test at 375px width)
- [ ] `<title>` and meta tags are appropriate
- [ ] No console errors
- [ ] All API calls have error handling (try/catch, show toast on error)
- [ ] Task history table loads and displays correctly
- [ ] Cost estimation shows before purchase
- [ ] Rating UI works on completed tasks
