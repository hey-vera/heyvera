# Frontend Rehaul — Master Plan

> **Original brief:** "I want you to do an entire front end rehaul, every page getting rehauled, make a very comprehensive document for everything sonnet needs to know, the main part you will be changing is marketplace to accommodate for the internal updates, I also want every page to be peak professionalism, style (formal developer like). The current theme and colors are not professional enough. I want an entire rehaul to really make the front end of this project shine."

---

## Architecture Overview

**Design philosophy:** Linear/Vercel/Stripe-inspired. Muted dark theme, restrained teal-green accent (#10b981), Inter font, information-dense, no gimmicks. Developer tool aesthetic.

**Tech:** Plain HTML + vanilla JS. No build system. Files served from `/var/www/claw-net/`. Shared design system duplicated in each file's `<style>` block.

**Design spec:** `FRONTEND_REHAUL.md` — original master design document (colors, fonts, components, per-page specs)

---

## Per-Page Plans (execute in order)

| # | File | Plan | Status | Complexity |
|---|---|---|---|---|
| 1 | `site/index.html` | [rehaul_index.md](rehaul_index.md) | COMPLETED | — |
| 2 | `site/dashboard.html` | [rehaul_dashboard.md](rehaul_dashboard.md) | COMPLETED | — |
| 3 | `site/marketplace.html` | [rehaul_marketplace.md](rehaul_marketplace.md) | COMPLETED | Very High |
| 4 | `site/docs.html` | [rehaul_docs.md](rehaul_docs.md) | COMPLETED | High |
| 5 | `site/endpoints.html` | [rehaul_endpoints.md](rehaul_endpoints.md) | NOT STARTED | Medium |
| 6 | `site/login.html` | [rehaul_login.md](rehaul_login.md) | NOT STARTED | Low |
| 7 | `site/success.html` | [rehaul_success.md](rehaul_success.md) | NOT STARTED | Low |
| 8 | `site/admin.html` | [rehaul_admin.md](rehaul_admin.md) | NOT STARTED | Low |
| 9 | `site/contact-section.html` | [rehaul_contact.md](rehaul_contact.md) | NOT STARTED | Low |

---

## Shared Design System (copy from `site/index.html`)

Every page must have identical:

### CSS Variables (index.html lines 22-61)
```
--bg-primary: #0a0a0b        --accent: #10b981
--bg-surface: #111113        --accent-dim: rgba(16,185,129,0.12)
--bg-surface-2: #18181b      --accent-hover: #34d399
--bg-surface-3: #1f1f23      --danger: #ef4444
--border-subtle: #1e1e22     --warning: #f59e0b
--border-default: #27272a    --info: #3b82f6
--border-strong: #3f3f46     --purple: #8b5cf6
--text-primary: #fafafa      --font-sans: Inter
--text-secondary: #a1a1aa    --font-mono: JetBrains Mono
--text-tertiary: #71717a     --font-display: Inter
--text-muted: #52525b        --radius-lg: 8px, --radius-md: 6px
```

### Component Classes
- `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-purple`, `.btn-lg`
- `.card` (bg-surface, border-subtle, radius-lg)
- `.input` (accent focus ring)
- `.badge`, `.badge-success`, `.badge-danger`, `.badge-warning`, `.badge-info`, `.badge-neutral`

### Nav (identical on every page, change only `active` class)
Source: index.html lines 517-540

### Footer (identical on every page)
Source: index.html lines 935-951

### Fonts
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### Clerk (every page)
```html
<script data-clerk-publishable-key="pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA"
  src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  onload="initNav()"></script>
```

---

## Kill List (remove from EVERY page)

- `#00ff88` (neon green) → `var(--accent)` / `#10b981`
- IBM Plex Serif → gone
- Space Mono → gone (JetBrains Mono for code only)
- `body::before` grid background overlay
- Noise texture overlays
- Terminal/hacker animations
- `--green`, `--green-dim`, `--green-glow` → `--accent`, `--accent-dim`, `--accent-subtle`

---

## Backend Routes — All Verified

Every API endpoint the frontend calls has been audited. **No backend changes needed.**

| Route File | Key Endpoints | Verified |
|---|---|---|
| `src/routes/marketplace.ts` | browse, detail, star, purchase, transactions, stake, creator stats, withdraw, report, versions, search | Yes |
| `src/routes/tasks.ts` | submit, list, detail, cancel, rate | Yes |
| `src/routes/auth-tokens.ts` | me, estimate, usage | Yes |
| `src/routes/skills.ts` | CRUD, invoke, visibility, metrics | Yes |
| `src/routes/dashboard.ts` | me, regenerate-key, claim | Yes |

---

## NEW Features (marketplace only)

These backend endpoints ALREADY EXIST but the current `marketplace.html` doesn't use them yet:

1. **Task History tab** — `GET /v1/tasks` (list), `GET /v1/tasks/:id` (detail)
2. **Rate completed tasks** — `POST /v1/tasks/:id/rate` (1-5 stars + comment)
3. **Cancel pending tasks** — `POST /v1/tasks/:id/cancel`
4. **Cost estimation before purchase** — `GET /v1/auth/estimate?skillId=`
5. **Usage stats** — `GET /v1/auth/usage` (tasks + marketplace breakdown)

See [rehaul_marketplace.md](rehaul_marketplace.md) for full implementation details.

---

## Quality Checklist (verify after EACH page)

- [ ] Identical nav and footer
- [ ] No `#00ff88` — only `#10b981` / `var(--accent)`
- [ ] No IBM Plex Serif, Space Mono
- [ ] No grid background or noise texture
- [ ] All numbers use `toLocaleString()`
- [ ] API status dot in nav polls `/health`
- [ ] Credits badge shows when logged in
- [ ] Buttons have hover states
- [ ] Inputs have accent focus ring
- [ ] Cards have `border-radius: var(--radius-lg)`
- [ ] Mobile responsive at 375px
- [ ] No console errors
- [ ] All API calls have try/catch + toast on error
