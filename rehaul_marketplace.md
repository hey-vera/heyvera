# Rehaul: marketplace.html

**Status:** NOT STARTED
**Current file:** `site/marketplace.html` — 1328 lines, old design system
**Complexity:** Very High — largest page, 6+ tabs, detail view, publish form, creator dashboard
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html` (already done)

---

## Design System Migration

### Fonts
Replace:
```html
<!-- OLD -->
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<!-- NEW -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### CSS Variable Mapping (find → replace)
| Old | New |
|---|---|
| `--green` / `#00ff88` | `var(--accent)` / `#10b981` |
| `--green-dim` | `var(--accent-dim)` |
| `--green-glow` | `var(--accent-subtle)` |
| `--bg` / `#060606` | `var(--bg-primary)` / `#0a0a0b` |
| `--surface` / `#0d0d0d` | `var(--bg-surface)` / `#111113` |
| `--surface2` / `#111` | `var(--bg-surface-2)` / `#18181b` |
| `--surface3` / `#161616` | `var(--bg-surface-3)` / `#1f1f23` |
| `--border` / `#1a1a1a` | `var(--border-subtle)` / `#1e1e22` |
| `--border2` / `#242424` | `var(--border-default)` / `#27272a` |
| `--border3` / `#2e2e2e` | `var(--border-strong)` / `#3f3f46` |
| `--text` / `#e0e0e0` | `var(--text-secondary)` / `#a1a1aa` |
| `--muted` / `#888` | `var(--text-tertiary)` / `#71717a` |
| `--muted2` / `#c0c0c0` | `var(--text-secondary)` / `#a1a1aa` |
| `--red` / `#ff4444` | `var(--danger)` / `#ef4444` |
| `--yellow` / `#ffaa00` | `var(--warning)` / `#f59e0b` |
| `--blue` / `#4488ff` | `var(--info)` / `#3b82f6` |
| `--font` (JetBrains Mono) | `var(--font-sans)` (Inter) for body |
| `--serif` (IBM Plex Serif) | `var(--font-display)` (Inter) |
| `color: #fff` | `var(--text-primary)` |
| `font-family: var(--serif)` | `font-family: var(--font-display)` |

### Remove Entirely
- `body::before` grid background overlay (the green grid lines)
- `::selection { background: rgba(0,255,136,0.2) }` → `::selection { background: var(--accent-dim) }`
- `hero-eyebrow::before { content: '\25C6' }` diamond character
- All `letter-spacing: 1.5px` and `text-transform: uppercase` on body-level text (keep only on tiny labels)

### Add To All Elements
- `border-radius: var(--radius-lg)` on cards
- `border-radius: var(--radius-md)` on buttons, inputs, badges
- `font-family: var(--font-sans)` as default (NOT monospace)
- `font-family: var(--font-mono)` ONLY for: prices, credit numbers, task IDs, code blocks, API keys

---

## Structural HTML Changes

### Nav — Replace Entirely
Replace the current `<nav>` (lines 296-321) with the shared nav from `site/index.html` lines 517-540. Only change: set `class="active"` on the Marketplace link.

### Footer — Add New
Current marketplace has NO footer. Add the shared footer from `site/index.html` lines 935-951, placed before `</body>`.

### Toast Container
Keep `<div id="toast-container"></div>` but update toast CSS to use design system colors.

---

## Tab System Changes

### Current tabs: Browse, Publish, My Skills, Starred, How It Works
### New tabs: Browse, Publish, My Skills, Starred, **Task History (NEW)**, How It Works

Add to `#main-tabs`:
```html
<button class="tab" data-tab="tasks">Task History</button>
```

Add tab panel (after `tp-starred`, before `tp-economy`):
```html
<div class="tab-panel" id="tp-tasks">
  <div id="tasks-auth" style="display:none">
    <div class="card" style="text-align:center;padding:40px">
      <p style="color:var(--text-tertiary);margin-bottom:12px">Sign in and set your API key to view task history</p>
      <a href="/login.html" class="btn btn-primary">Sign In</a>
    </div>
  </div>
  <div id="tasks-content" style="display:none">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
      <div class="card"><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--text-primary)" id="ts-total">—</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Total Tasks</div></div>
      <div class="card"><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent)" id="ts-completed">—</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Completed</div></div>
      <div class="card"><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--text-primary)" id="ts-credits">—</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Credits Spent</div></div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid var(--border-subtle)">
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Task ID</th>
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Skill</th>
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Status</th>
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Credits</th>
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Duration</th>
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Created</th>
            <th style="font-size:11px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;text-align:left;padding:10px 16px">Actions</th>
          </tr>
        </thead>
        <tbody id="tasks-tbody"></tbody>
      </table>
    </div>
    <div id="tasks-pagination" style="margin-top:16px"></div>
  </div>
</div>
```

---

## NEW JavaScript Functions to Add

### 1. Task History Loading

```javascript
let taskPage = 0;
const TASK_LIMIT = 20;

async function loadTaskHistory() {
  const auth = document.getElementById('tasks-auth');
  const content = document.getElementById('tasks-content');
  if (!apiKey) { auth.style.display = 'block'; content.style.display = 'none'; return; }
  auth.style.display = 'none'; content.style.display = 'block';

  const tbody = document.getElementById('tasks-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-tertiary)">Loading...</td></tr>';

  try {
    // Fetch usage stats for the 3 stat cards
    const ur = await fetch(`${API}/v1/auth/usage`, { headers: { 'X-API-Key': apiKey } });
    if (ur.ok) {
      const ud = await ur.json();
      document.getElementById('ts-total').textContent = (ud.tasks?.total ?? 0).toLocaleString();
      document.getElementById('ts-completed').textContent = (ud.tasks?.completed ?? 0).toLocaleString();
      document.getElementById('ts-credits').textContent = (ud.tasks?.creditsSpent ?? 0).toLocaleString();
    }

    // Fetch task list
    const r = await fetch(`${API}/v1/tasks?limit=${TASK_LIMIT}&offset=${taskPage * TASK_LIMIT}`, {
      headers: { 'X-API-Key': apiKey }
    });
    if (!r.ok) throw new Error();
    const d = await r.json();

    if (!d.tasks.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-tertiary)">No tasks yet. Purchase and run a skill to see tasks here.</td></tr>';
      return;
    }

    tbody.innerHTML = d.tasks.map(t => `
      <tr style="border-bottom:1px solid var(--border-subtle)">
        <td style="padding:12px 16px;font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${esc(t.id.slice(0,10))}...</td>
        <td style="padding:12px 16px;color:var(--text-secondary)">${esc(t.skillId)}</td>
        <td style="padding:12px 16px"><span class="badge badge-${statusClass(t.status)}">${t.status}</span></td>
        <td style="padding:12px 16px;font-family:var(--font-mono);color:var(--text-secondary)">${t.costCredits != null ? t.costCredits.toLocaleString() : '—'}</td>
        <td style="padding:12px 16px;font-family:var(--font-mono);color:var(--text-tertiary)">${t.durationMs ? t.durationMs + 'ms' : '—'}</td>
        <td style="padding:12px 16px;color:var(--text-tertiary)">${timeAgo(t.createdAt)}</td>
        <td style="padding:12px 16px">${taskActions(t)}</td>
      </tr>
    `).join('');

    renderTaskPagination(d.total);
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger)">Failed to load tasks</td></tr>';
  }
}

function statusClass(s) {
  return { COMPLETED:'success', FAILED:'danger', RUNNING:'info', PENDING:'neutral', CANCELLED:'warning' }[s] || 'neutral';
}

function taskActions(t) {
  let html = '';
  if (t.status === 'COMPLETED') html += `<button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="rateTask('${esc(t.id)}')">Rate</button>`;
  if (t.status === 'PENDING') html += `<button class="btn btn-ghost" style="font-size:11px;padding:4px 8px;color:var(--danger);border-color:var(--danger-dim)" onclick="cancelTask('${esc(t.id)}')">Cancel</button>`;
  return html || '<span style="color:var(--text-muted)">—</span>';
}

function renderTaskPagination(total) {
  const el = document.getElementById('tasks-pagination');
  const pages = Math.ceil(total / TASK_LIMIT);
  if (pages <= 1) { el.innerHTML = ''; return; }
  const btns = [];
  btns.push(`<button class="btn btn-ghost" style="font-size:12px;padding:6px 10px" onclick="goTaskPage(${taskPage-1})" ${taskPage<=0?'disabled':''}>Prev</button>`);
  btns.push(`<span style="font-size:12px;color:var(--text-tertiary);padding:0 8px">Page ${taskPage+1} of ${pages}</span>`);
  btns.push(`<button class="btn btn-ghost" style="font-size:12px;padding:6px 10px" onclick="goTaskPage(${taskPage+1})" ${taskPage>=pages-1?'disabled':''}>Next</button>`);
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px">${btns.join('')}</div>`;
}

function goTaskPage(p) { taskPage = p; loadTaskHistory(); }
```

**API:** `GET /v1/tasks?limit=20&offset=0` — requires `X-API-Key` header
**Response:** `{ tasks: [{ id, skillId, status, costCredits, durationMs, createdAt, completedAt }], total, limit, offset }`
**Backend:** `src/routes/tasks.ts` line 236-260 — CONFIRMED EXISTS

### 2. Rate Completed Task

```javascript
async function rateTask(taskId) {
  if (!apiKey) { toast('Set API key first', 'error'); return; }
  const rating = prompt('Rate this task (1-5 stars):');
  const n = parseInt(rating);
  if (!n || n < 1 || n > 5) { if (rating !== null) toast('Enter a number 1-5', 'error'); return; }
  const comment = prompt('Optional comment (or leave blank):') || undefined;
  try {
    const r = await fetch(`${API}/v1/tasks/${taskId}/rate`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: n, comment }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Rating failed', 'error'); return; }
    toast(`Rated ${n}/5`, 'success');
    loadTaskHistory();
  } catch { toast('Network error', 'error'); }
}
```

**API:** `POST /v1/tasks/:id/rate` — body: `{ rating: 1-5, comment?: string }`
**Backend:** `src/routes/tasks.ts` line 317-363 — CONFIRMED EXISTS

### 3. Cancel Pending Task

```javascript
async function cancelTask(taskId) {
  if (!confirm('Cancel this task?')) return;
  try {
    const r = await fetch(`${API}/v1/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Cancel failed', 'error'); return; }
    toast('Task cancelled', 'success');
    loadTaskHistory();
  } catch { toast('Network error', 'error'); }
}
```

**API:** `POST /v1/tasks/:id/cancel` — only PENDING tasks
**Backend:** `src/routes/tasks.ts` line 294-308 — CONFIRMED EXISTS

### 4. Cost Estimation (in skill detail view)

Add `<div id="cost-estimate" style="display:none;margin-bottom:16px"></div>` inside the detail view, after the meta grid.

```javascript
async function loadCostEstimate(skillId) {
  if (!apiKey) return;
  try {
    const r = await fetch(`${API}/v1/auth/estimate?skillId=${encodeURIComponent(skillId)}`, {
      headers: { 'X-API-Key': apiKey }
    });
    if (!r.ok) return;
    const d = await r.json();
    const el = document.getElementById('cost-estimate');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card" style="display:flex;align-items:center;gap:12px;padding:16px">
      <span style="font-size:13px;color:var(--text-secondary)">Estimated cost:</span>
      <strong style="font-family:var(--font-mono);color:var(--accent)">${d.estimatedCredits} credits</strong>
      ${d.canAfford
        ? '<span class="badge badge-success">You can afford this</span>'
        : '<span class="badge badge-danger">Insufficient credits</span>'}
      ${d.note ? `<span style="font-size:11px;color:var(--text-tertiary)">${esc(d.note)}</span>` : ''}
    </div>`;
  } catch {}
}
```

Call `loadCostEstimate(s.id)` at the end of `loadSkillDetail()` after rendering the detail HTML.

**API:** `GET /v1/auth/estimate?skillId=` — returns `{ skillId, skillName, estimatedCredits, note, creditCost, canAfford }`
**Backend:** `src/routes/auth-tokens.ts` line 25-48 — CONFIRMED EXISTS

### 5. timeAgo() Helper

```javascript
function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}
```

---

## Routing Update

In `handleRoute()`, add:
```javascript
if (tabName === 'tasks') loadTaskHistory();
```

---

## ALL Existing JS Functions to Preserve

Every function below must be kept with identical API call logic. Restyle the HTML they generate, but do NOT change the fetch URLs, request bodies, or response handling.

| Function | API Call | Notes |
|---|---|---|
| `loadSkills()` | `GET /v1/marketplace/skills?page=&limit=12&sort=&search=&category=` | Browse catalog |
| `renderCard(s)` | — | Update CSS classes only |
| `renderPagination(page, pages)` | — | Update CSS classes only |
| `loadSkillDetail(id)` | `GET /v1/marketplace/skills/:id` | Add cost estimate call |
| `doBuy()` | `POST /v1/marketplace/skills/:id/purchase` | Keep exact flow |
| `toggleStar(id, btn, evt)` | `POST/DELETE /v1/marketplace/skills/:id/star` | Keep exact flow |
| `doReport(skillId)` | `POST /v1/marketplace/skills/:id/report` | Keep exact flow |
| `loadStarredView()` | Individual `GET /v1/marketplace/skills/:id` per star | Keep exact flow |
| `publishSkill()` | `POST /v1/skills` | Keep exact flow |
| `onSlugInput()` | — | Keep |
| `updateValidation()` | — | Keep |
| `loadMySkills()` | `GET /v1/marketplace/creator/stats` | Keep exact flow |
| `toggleVis(id, pub)` | `PATCH /v1/skills/:id/visibility` | Keep |
| `delSkill(id)` | `DELETE /v1/skills/:id` | Keep |
| `requestWithdraw()` | `POST /v1/marketplace/creator/withdraw` | Keep |
| `loadWithdrawHistory()` | `GET /v1/marketplace/creator/withdrawals` | Keep |
| `loadHeroStats()` | `GET /v1/marketplace/skills?limit=1` | Keep |
| `debounceSearch()` | — | Keep |
| `goPage(p)` | — | Keep |
| `initNav()` | Clerk SDK | Keep |
| `navSignOut()` | Clerk SDK | Keep |
| `refreshCredits()` | `GET /v1/dashboard/me` | Keep |
| `fetchApiStatus()` | `GET ${API}/v1/health` | Keep (note: uses /v1/health not /health, works fine) |
| `esc(s)` | — | Keep |
| `fmt(n)` | — | Keep |
| `toast(msg, type)` | — | Update CSS only |
| `saveStarred()` | — | Keep |

### Constants to Preserve
```javascript
const API = 'https://api.claw-net.org';
const OFFICIAL = new Set(['token-analysis','social-sentiment','portfolio-optimizer','wallet-profiler','trending-tokens','whale-tracker','defi-yield-scanner','token-launch-radar','price-oracle','nft-collection-intel']);
const CAT_ICONS = {defi:'⬡',security:'🔒',social:'◎',ai:'✦',search:'⌕',media:'▶',enrichment:'⊕',analytics:'∿',infrastructure:'⚙',utility:'◇',weather:'☁',general:'◆'};
let apiKey = localStorage.getItem('claw_api_key') || '';
let currentPage = 1, currentCat = '', currentSort = 'popular';
let searchTimer = null;
let starredIds = new Set(JSON.parse(localStorage.getItem('claw_starred') || '[]'));
```

### Clerk Script Tag
```html
<script data-clerk-publishable-key="pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA"
  src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  onload="initNav()"></script>
```

---

## Badge CSS (add to style block)

```css
.badge { font-family: var(--font-sans); font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; }
.badge-success { background: var(--accent-dim); color: var(--accent); }
.badge-danger { background: var(--danger-dim); color: var(--danger); }
.badge-warning { background: var(--warning-dim); color: var(--warning); }
.badge-info { background: var(--info-dim); color: var(--info); }
.badge-neutral { background: rgba(113,113,122,0.15); color: var(--text-tertiary); }
```

---

## Verification Checklist

After completing, verify:
- [ ] All 6 tabs work (Browse, Publish, My Skills, Starred, Task History, How It Works)
- [ ] Hash routing works: `#browse`, `#publish`, `#my-skills`, `#starred`, `#tasks`, `#economy`
- [ ] `#skill/{id}` detail view loads with cost estimate
- [ ] Task History shows tasks, ratings work, cancel works
- [ ] Browse search/filter/sort/pagination all work
- [ ] Publish form with validation sidebar works
- [ ] My Skills tab with creator stats + withdraw works
- [ ] Star/unstar works
- [ ] Report works
- [ ] No `#00ff88` anywhere
- [ ] No IBM Plex Serif or Space Mono
- [ ] No grid background overlay
- [ ] All numbers use `toLocaleString()`
- [ ] Nav credits badge updates after purchase
- [ ] Footer present
- [ ] Mobile responsive at 375px
