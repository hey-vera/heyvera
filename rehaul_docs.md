# Rehaul: docs.html

**Status:** NOT STARTED
**Current file:** `site/docs.html` — 1380 lines, old design system
**Complexity:** High — full API reference with sidebar navigation
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html`

---

## Overview

Complete rewrite of the API documentation page. Stripe API docs-inspired layout: fixed sidebar on left, scrollable content on right. Professional, information-dense, developer-focused.

---

## Structure

### 1. Nav (shared — copy from `site/index.html`)
Set `class="active"` on the "Docs" link.

### 2. Page Layout
```html
<div class="docs-layout">
  <aside class="docs-sidebar" id="sidebar">
    <!-- Table of contents -->
  </aside>
  <main class="docs-content">
    <!-- Endpoint documentation -->
  </main>
</div>
```

```css
.docs-layout { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 56px); }
.docs-sidebar {
  position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto;
  border-right: 1px solid var(--border-subtle); padding: 24px 0;
  background: var(--bg-surface);
}
.docs-content { padding: 40px 48px; max-width: 900px; }

@media (max-width: 768px) {
  .docs-layout { grid-template-columns: 1fr; }
  .docs-sidebar { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border-subtle); }
}
```

### 3. Sidebar Table of Contents

Each group is a collapsible section:
```html
<div class="sidebar-group">
  <div class="sidebar-heading">Authentication</div>
  <a class="sidebar-link" href="#auth-api-key">API Key</a>
  <a class="sidebar-link" href="#auth-clerk">Clerk JWT</a>
</div>
```

```css
.sidebar-heading {
  font-size: 11px; font-weight: 600; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 8px 24px; margin-top: 16px;
}
.sidebar-link {
  display: block; font-size: 13px; color: var(--text-tertiary);
  padding: 6px 24px; transition: all 0.15s;
}
.sidebar-link:hover { color: var(--text-primary); background: var(--bg-surface-2); }
.sidebar-link.active { color: var(--accent); border-right: 2px solid var(--accent); }
```

### 4. Endpoint Documentation Pattern

Each endpoint follows this template:
```html
<section class="endpoint" id="tasks-submit">
  <div class="endpoint-header">
    <span class="method-badge post">POST</span>
    <code class="endpoint-path">/v1/tasks</code>
  </div>
  <p class="endpoint-desc">Submit a task for execution.</p>
  <div class="endpoint-auth">Requires: <code>X-API-Key</code> header</div>

  <h4>Parameters</h4>
  <table class="params-table">
    <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>skillId</code></td><td>string</td><td>Yes</td><td>The skill to execute</td></tr>
      <tr><td><code>variables</code></td><td>object</td><td>No</td><td>Key-value pairs for template variables</td></tr>
      <tr><td><code>idempotencyKey</code></td><td>string</td><td>No</td><td>Prevent duplicate execution (max 128 chars)</td></tr>
      <tr><td><code>webhookUrl</code></td><td>string</td><td>No</td><td>URL to POST results when complete</td></tr>
    </tbody>
  </table>

  <h4>Example Request</h4>
  <div class="code-block">
    <button class="copy-btn" onclick="copyCode(this)">Copy</button>
    <pre><code>curl -X POST https://api.claw-net.org/v1/tasks \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"skillId":"token-analysis","variables":{"token":"SOL"}}'</code></pre>
  </div>

  <h4>Example Response</h4>
  <div class="code-block">
    <pre><code>{
  "taskId": "abc123def456",
  "status": "COMPLETED",
  "result": {
    "answer": "SOL analysis...",
    "creditsUsed": 5,
    "durationMs": 1240
  }
}</code></pre>
  </div>
</section>
```

### 5. Method Badge CSS
```css
.method-badge {
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
  padding: 3px 8px; border-radius: var(--radius-sm);
  text-transform: uppercase; letter-spacing: 0.02em;
}
.method-badge.get { background: var(--info-dim); color: var(--info); }
.method-badge.post { background: var(--accent-dim); color: var(--accent); }
.method-badge.delete { background: var(--danger-dim); color: var(--danger); }
.method-badge.patch { background: var(--warning-dim); color: var(--warning); }
.method-badge.put { background: var(--purple-dim); color: var(--purple); }
```

### 6. Code Block CSS
```css
.code-block {
  position: relative; background: var(--bg-primary);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
  overflow-x: auto; margin: 12px 0 24px;
}
.code-block pre { padding: 16px; margin: 0; }
.code-block code {
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text-secondary); line-height: 1.6;
}
.copy-btn {
  position: absolute; top: 8px; right: 8px;
  font-family: var(--font-sans); font-size: 11px;
  padding: 4px 8px; background: var(--bg-surface-2);
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-tertiary); cursor: pointer; transition: all 0.15s;
}
.copy-btn:hover { color: var(--text-primary); border-color: var(--border-strong); }
```

### 7. Copy Button JS
```javascript
function copyCode(btn) {
  const code = btn.parentElement.querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
```

### 8. Footer (shared — copy from `site/index.html`)

---

## Sidebar Groups — ALL Endpoint Groups to Document

### Authentication
- API Key: `X-API-Key` header on all authenticated endpoints
- Clerk JWT: `Authorization: Bearer {token}` from Clerk session

### Orchestration
- `POST /v1/orchestrate` — natural language query → orchestrated answer

### Skills
- `POST /v1/skills` — create skill
- `GET /v1/skills/mine` — list your skills
- `GET /v1/skills/:id` — get skill detail
- `POST /v1/skills/:id/invoke` — invoke skill (free or owned)
- `PATCH /v1/skills/:id/visibility` — toggle public/private
- `DELETE /v1/skills/:id` — delete skill
- `GET /v1/skills/:id/metrics` — performance metrics

### Tasks (NEW — document all 5)
- `POST /v1/tasks` — submit task
- `GET /v1/tasks` — list tasks (paginated)
- `GET /v1/tasks/:id` — task detail
- `POST /v1/tasks/:id/cancel` — cancel pending task
- `POST /v1/tasks/:id/rate` — rate completed task (1-5)

### Marketplace
- `GET /v1/marketplace/skills` — browse catalog (paginated, filterable)
- `GET /v1/marketplace/skills/:id` — skill detail
- `POST /v1/marketplace/skills/:id/purchase` — purchase & execute
- `POST /v1/marketplace/skills/:id/star` — star skill
- `DELETE /v1/marketplace/skills/:id/star` — unstar skill
- `POST /v1/marketplace/skills/:id/report` — report skill
- `GET /v1/marketplace/skills/:id/versions` — version history
- `GET /v1/marketplace/search?q=` — search
- `GET /v1/marketplace/transactions` — transaction history
- `POST /v1/marketplace/stake` — stake credits
- `POST /v1/marketplace/unstake/:stakeId` — unstake
- `GET /v1/marketplace/stakes` — view stakes
- `GET /v1/marketplace/creator/stats` — creator dashboard
- `POST /v1/marketplace/creator/withdraw` — request USDC payout
- `GET /v1/marketplace/creator/withdrawals` — payout history

### Auth & Credits (NEW — document all 3)
- `GET /v1/auth/me` — current key info
- `GET /v1/auth/estimate?skillId=` — cost estimate for a skill
- `GET /v1/auth/usage` — usage summary (tasks + marketplace)

### Discovery
- `POST /v1/discover` — semantic skill discovery

### Escrow
- `POST /v1/escrow` — create escrow
- `GET /v1/escrow` — list escrows
- `GET /v1/escrow/:id` — escrow detail
- `POST /v1/escrow/:id/submit` — submit work
- `POST /v1/escrow/:id/approve` — approve & release
- `POST /v1/escrow/:id/dispute` — dispute escrow

### Governance
- `POST /v1/governance/proposals` — create proposal
- `GET /v1/governance/proposals` — list proposals
- `POST /v1/governance/proposals/:id/vote` — cast vote

### Registry
- `GET /v1/registry` — all registered API endpoints
- `GET /v1/registry/health` — endpoint health status
- `GET /v1/registry/:id` — endpoint detail

### LLM Proxy
- `GET /v1/llm/models` — available models
- `POST /v1/llm/chat` — OpenAI-compatible chat completion
- `POST /v1/llm/embeddings` — generate embeddings

### Streaming
- `GET /v1/stream/orchestrate?query=` — SSE streaming orchestration

### Batch
- `POST /v1/batch` — parallel multi-query orchestration (up to 10 queries)

### Mesh
- `GET /v1/mesh/peers` — connected mesh peers

### Admin
- `GET /v1/admin/dashboard` — admin metrics (requires ADMIN_API_KEY)
- `GET /v1/admin/revenue` — platform revenue breakdown
- `GET /v1/admin/treasury` — treasury balances
- `GET /v1/admin/payouts` — pending payouts

---

## Verification Checklist

- [ ] Sidebar scrolls independently from content
- [ ] All endpoint groups documented with request/response examples
- [ ] Method badges colored correctly (GET=blue, POST=green, DELETE=red, PATCH=yellow)
- [ ] Code blocks have working copy buttons
- [ ] Mobile: sidebar collapses to dropdown
- [ ] Active sidebar link highlights when scrolling
- [ ] No `#00ff88`, no IBM Plex Serif, no grid background
- [ ] Nav and footer identical to other pages
