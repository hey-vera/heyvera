# Frontend Considerations — Stats & MCP Setup Pages

Inspired by 402bot's operator dashboard and MCP setup page. These would be new pages in `site/`.

## 1. Stats / Live Telemetry Page (`site/stats.html`)

### What 402bot Shows
Their `/metrics` page displays live telemetry with these metrics:
- Endpoints Indexed: 1,444
- New Endpoints 30d: 1,409
- MCP Partners: 76
- Probe Coverage: 11%
- Average Uptime: 99.98%
- MCP Requests/Day: 169
- Payment Events: 751.1K
- Attributed Flow: $1.1M

Charts: MCP Traffic (requests/day), Economic Events (daily), with 1M/5M/15M time filters.

### What ClawNet Should Show

**Top-level stats (from existing `/v1/stats/roadmap` and admin endpoints):**
- Total Skills: count of published skills
- Total API Endpoints: 344+
- Credit Transactions (30d): count from transactions table
- Total Credits Transacted (30d): sum
- Active API Keys: count of active keys
- Orchestrations (30d): count
- Cache Hit Rate: from cache stats
- Average Latency: from skill metrics
- x402 Payments: count from x402_receipts
- x402 Revenue: sum from x402_receipts
- Uptime: from /health endpoint uptime field

**Charts (fetch from API, render with vanilla JS — no Chart.js dependency, use CSS bar charts or simple SVG):**
- Orchestrations per day (30d rolling)
- Credits consumed per day
- Skill invocations per day
- x402 payments per day

**Design approach:**
- Dark theme matching existing site (check site/index.html for current color scheme)
- Grid of stat cards (CSS grid, `auto-fit minmax(160px, 1fr)`)
- Bar charts rendered as flexbox bars (div heights proportional to max value)
- Auto-refresh every 60s via `setInterval` + `fetch`
- Mobile responsive: 2-column on tablet, 1-column on mobile

**API endpoints to fetch:**
- `GET /v1/stats/roadmap` — existing stats endpoint
- `GET /health` — uptime, db status
- `GET /v1/cache/stats` — cache hit rate (if public)
- Could add `GET /v1/stats/telemetry` route for aggregated daily stats

**New backend route needed:** `GET /v1/stats/telemetry` — returns:
```json
{
  "totalSkills": 17,
  "totalEndpoints": 344,
  "activeKeys": 42,
  "orchestrations30d": 1500,
  "creditsTransacted30d": 25000,
  "cacheHitRate": 0.73,
  "avgLatencyMs": 450,
  "x402Payments": 85,
  "x402Revenue": "12.50",
  "dailyOrchestrations": [{ "date": "2026-03-15", "count": 52 }, "..."],
  "dailyCredits": [{ "date": "2026-03-15", "amount": 850.5 }, "..."],
  "dailySkillInvocations": [{ "date": "2026-03-15", "count": 120 }, "..."],
  "dailyX402": [{ "date": "2026-03-15", "count": 3, "revenue": "0.45" }, "..."]
}
```

### Design Tokens (match existing ClawNet design system from site/index.html)

```css
/* Use existing ClawNet CSS variables — do NOT invent new ones */
:root {
  /* Base — already defined in index.html */
  --bg-primary: #0a0a0b;
  --bg-surface: #111113;
  --bg-surface-2: #18181b;
  --bg-surface-3: #1f1f23;

  /* Accent — ClawNet brand green (already defined) */
  --accent: #10b981;
  --accent-dim: rgba(16, 185, 129, 0.12);
  --accent-hover: #34d399;
  --accent-text: #6ee7b7;

  /* Text — already defined */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;

  /* Status */
  --status-good: #10b981;  /* reuse --accent */
  --status-warn: #f59e0b;  /* reuse --warning */
  --status-bad: #ef4444;   /* reuse --danger */

  /* Borders — already defined */
  --border-subtle: #1e1e22;
  --border-default: #27272a;

  /* Typography — already defined */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
}
```

### Stat Card HTML Pattern
```html
<div class="stat-card">
  <div class="stat-label">TOTAL SKILLS</div>
  <div class="stat-value" id="totalSkills">--</div>
</div>
```

### CSS Bar Chart Pattern (no external deps)
```html
<div class="chart">
  <div class="chart-title">Orchestrations per Day</div>
  <div class="chart-bars" id="orchestrationChart">
    <!-- JS fills: <div class="bar" style="height: 72%"><span>52</span></div> -->
  </div>
</div>
```

---

## 2. MCP Setup Page (`site/mcp-setup.html`)

### What 402bot Shows
- Big headline: "ONE PASTE TO A WORKING MCP CONNECTION"
- Tab system for different clients: Claude Desktop, Claude Code, Cursor, Codex CLI, Gemini CLI, Glama, Local Stdio Bridge, OpenClaw, Generic Remote MCP JSON
- Copy-paste config blocks for each
- "Setup Markdown" and "Directory Kit" buttons
- First prompt suggestion
- Campaign-aware variants

### What ClawNet Should Show

**Headline:** "Connect to ClawNet in One Paste"
**Subtitle:** "Add ClawNet's AI skill marketplace to your favorite AI assistant."

**Server info bar:**
- Server: `clawnet/orchestrator`
- Transport: `streamable-http` (remote) / `stdio` (local)
- API key: `optional (required for paid operations)`

**Tab system (6 tabs):**

1. **Claude Desktop** — config for `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "clawnet": {
      "type": "http",
      "url": "https://api.claw-net.org/mcp"
    }
  }
}
```

2. **Claude Code** — CLI command:
```bash
claude mcp add-json clawnet '{"type":"url","url":"https://api.claw-net.org/mcp"}'
```

3. **Cursor** — `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "clawnet": {
      "url": "https://api.claw-net.org/mcp"
    }
  }
}
```

4. **Codex CLI** — config:
```toml
[mcp_servers.clawnet]
type = "url"
url = "https://api.claw-net.org/mcp"
```

5. **Local (stdio)** — for development:
```json
{
  "mcpServers": {
    "clawnet": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "env": {
        "CLAWNET_BASE_URL": "https://api.claw-net.org",
        "CLAWNET_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

6. **Generic JSON** — raw MCP config:
```json
{
  "type": "url",
  "url": "https://api.claw-net.org/mcp"
}
```

**First prompt suggestion:**
> "List all available ClawNet skills and show me the top 5 most popular ones with their credit costs."

**Available tools section:**
- `list-skills` — Browse the skill marketplace
- `get-skill` — Get skill details and input variables
- `invoke-skill` — Execute a skill (requires API key)
- `search-registry` — Search 344+ API endpoints
- `orchestrate` — Natural language AI orchestration (requires API key)
- `get-credits` — Check your credit balance

**Quick links:**
- Get an API key: https://claw-net.org
- View llms.txt: /llms.txt
- View OpenAPI spec: /v1/openapi.json
- MCP discovery: /.well-known/mcp.json
- x402 (no key needed): /x402/skills

### Tab Implementation (vanilla JS)
```html
<div class="tab-bar">
  <button class="tab active" data-tab="claude-desktop">Claude Desktop</button>
  <button class="tab" data-tab="claude-code">Claude Code</button>
  <!-- ... -->
</div>
<div class="tab-content active" id="claude-desktop">
  <div class="code-block">
    <pre><code>{ ... }</code></pre>
    <button class="copy-btn" onclick="copyCode(this)">COPY</button>
  </div>
</div>
```

```javascript
// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Copy button
function copyCode(btn) {
  const code = btn.previousElementSibling.textContent;
  navigator.clipboard.writeText(code);
  btn.textContent = 'COPIED';
  setTimeout(() => btn.textContent = 'COPY', 2000);
}
```

### Design — use same dark theme as stats page, with:
- Hero section with large headline
- Info bar showing server/transport/auth details
- Tabbed config sections with syntax-highlighted code blocks
- Copy buttons on all code blocks
- Tool list as a grid of mini-cards
- Quick links section at bottom

---

## 3. Implementation Priority

| Page | Effort | Impact | Priority |
|------|--------|--------|----------|
| MCP Setup | 4-6 hours | High — reduces onboarding friction | P0 |
| Stats/Telemetry | 1-2 days (includes backend route) | Medium — builds trust, shows activity | P1 |

### Backend Work Needed

1. **`GET /v1/stats/telemetry`** — new route aggregating daily stats from orchestrations, transactions, skill_metrics, x402_receipts tables. Public (no auth) but rate-limited.

2. **MCP setup page** — pure frontend, no backend changes needed (all config is static).

### Notes
- All pages should match the existing site nav (check site/index.html for nav pattern)
- Use the existing CSS variables and design system from site/index.html (Inter + JetBrains Mono fonts, `--accent: #10b981`, dark surfaces, etc.)
- No external JS dependencies — vanilla JS only
- No build step — just HTML/CSS/JS files in site/
- Mobile-first responsive design
- Dark theme consistent with site (supports light theme via `[data-theme="light"]` overrides)
- Existing site has 17 HTML pages; these would bring it to 19

---

*Based on competitive analysis of 402bot (marketplace.402.bot) — March 2026*
