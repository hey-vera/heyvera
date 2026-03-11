# Rehaul: admin.html + admin-vps.html

**Status:** NOT STARTED
**Current files:** `site/admin.html` (121 lines) + `site/admin-vps.html` (111 lines), old design system
**Complexity:** Low
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html`

---

## Overview

Internal admin dashboard behind ADMIN_API_KEY. Shows platform metrics, revenue, circuit breaker status, and payout queue. `admin-vps.html` appears to be a duplicate/variant — check if both are needed or consolidate into one.

---

## Structure

### 1. Nav (shared)
No active link (admin page is not in the main nav). Optionally add a subtle "Admin" label.

### 2. Admin Key Input
```html
<div style="padding:80px 24px 24px;max-width:1100px;margin:0 auto">
  <h1 style="font-family:var(--font-display);font-size:28px;font-weight:600;color:var(--text-primary);margin-bottom:16px">Admin Dashboard</h1>
  <div style="display:flex;gap:8px;max-width:500px;margin-bottom:32px">
    <input type="password" class="input" id="admin-key" placeholder="ADMIN_API_KEY" style="flex:1">
    <button class="btn btn-primary" onclick="loadAdmin()">Load</button>
  </div>
</div>
```

### 3. Stats Grid (4 columns)
Cards showing: Total Revenue, Active Users, Pending Payouts, Open Disputes
Use `.card` class with `font-family: var(--font-mono)` for values.

### 4. Sections
- **Revenue Breakdown** — table from `GET /v1/admin/revenue`
- **Treasury Balances** — table from `GET /v1/admin/treasury`
- **Circuit Breaker Status** — table with status badges (badge-success for OK, badge-danger for OPEN)
- **Payout Queue** — table from `GET /v1/admin/payouts`
- **Key Management** — input to revoke a key (if this exists)

### 5. Footer (shared)

---

## Data Sources

| Endpoint | Data |
|---|---|
| `GET /v1/admin/dashboard` | Overall metrics |
| `GET /v1/admin/revenue` | Revenue breakdown |
| `GET /v1/admin/treasury` | Treasury + official key balances |
| `GET /v1/admin/payouts` | Pending payouts |

All require `X-API-Key` header with ADMIN_API_KEY value.

---

## CSS Patterns

Tables:
```css
.admin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.admin-table th { font-size: 11px; font-weight: 500; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; text-align: left; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); }
.admin-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
.admin-table tr:hover td { background: var(--bg-surface-2); }
```

---

## Decision: admin.html vs admin-vps.html

Read both files. If they serve the same purpose, consolidate into one `admin.html`. If `admin-vps.html` has VPS-specific metrics (disk, CPU, etc.), keep both but apply the same design system to both.

---

## Verification Checklist

- [ ] Admin key input works
- [ ] Stats grid loads with live data
- [ ] Revenue/treasury tables render
- [ ] Payout queue renders
- [ ] Badge colors correct
- [ ] All numbers use `toLocaleString()`
- [ ] No old design system remnants
- [ ] Mobile responsive
