# Rehaul: endpoints.html

**Status:** NOT STARTED
**Current file:** `site/endpoints.html` — 635 lines, old design system
**Complexity:** Medium
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html`

---

## Overview

Live catalog of all 158+ API endpoints the platform can call. Shows real-time health status, latency, and credit costs. Developer-focused, data-dense layout.

---

## Structure

### 1. Nav (shared)
Set `class="active"` on the "Endpoints" link.

### 2. Page Header
```html
<div style="padding:80px 24px 40px;max-width:1100px;margin:0 auto">
  <div style="font-size:12px;font-weight:500;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:12px">API Registry</div>
  <h1 style="font-family:var(--font-display);font-size:36px;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;margin-bottom:8px">API Endpoints</h1>
  <p style="font-size:16px;color:var(--text-secondary);margin-bottom:24px">Live catalog of all endpoints available through ClawNet orchestration.</p>
  <div style="display:flex;gap:24px;flex-wrap:wrap">
    <div><span style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--text-primary)" id="ep-total">—</span><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Total Endpoints</div></div>
    <div><span style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--accent)" id="ep-healthy">—</span><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Healthy</div></div>
    <div><span style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--warning)" id="ep-degraded">—</span><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Degraded</div></div>
  </div>
</div>
```

### 3. Controls
- Search input (`.input` class)
- Category filter dropdown
- Status filter: All / Operational / Degraded / Down

### 4. Endpoint Grid
Cards showing:
- Endpoint name + provider name
- Category badge
- Status dot (green=ok, yellow=degraded, red=down) + text
- Latency (avg ms) — `font-family: var(--font-mono)`
- Credit cost — `font-family: var(--font-mono)`

### 5. Footer (shared)

---

## Data Sources

- `GET /v1/endpoints` — returns array of all registered endpoints with name, provider, category, credit cost
- `GET /v1/registry/health` — returns health status per endpoint (latency, uptime, status)
- Poll health every 60 seconds

---

## Preserve from Current

- Search/filter JS logic
- Endpoint card rendering
- Status indicator logic
- Credit cost display
- Provider grouping/categorization

### Restyle only:
- Card CSS → new design system (`.card` class, `border-radius: var(--radius-lg)`)
- Status dot colors → `--accent` (ok), `--warning` (degraded), `--danger` (down)
- Font → Inter for body, JetBrains Mono for data values
- Remove all `#00ff88`, grid background, IBM Plex Serif

---

## Verification Checklist

- [ ] Endpoint count displayed and updating
- [ ] Health status dots working (green/yellow/red)
- [ ] Search filters endpoints in real time
- [ ] Category filter works
- [ ] Status filter works (All/Operational/Degraded/Down)
- [ ] Credit costs displayed per endpoint
- [ ] Mobile responsive
- [ ] No old design system remnants
- [ ] Nav and footer identical to other pages
