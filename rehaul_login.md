# Rehaul: login.html

**Status:** NOT STARTED
**Current file:** `site/login.html` — 267 lines, old design system
**Complexity:** Low
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html`

---

## Overview

Clerk-powered authentication page. Current version has a two-column split layout with feature list, grid background, and glow effects — all unnecessary for an auth page.

---

## Structure

### 1. Nav (minimal)
Use the shared nav but with NO active link. Only logo + sign-in state elements.

### 2. Centered Auth Card
```html
<div style="display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 56px - 80px);padding:24px">
  <div class="card" style="max-width:400px;width:100%;padding:40px">
    <h1 style="font-family:var(--font-display);font-size:24px;font-weight:600;color:var(--text-primary);text-align:center;margin-bottom:8px">Sign in to ClawNet</h1>
    <p style="font-size:14px;color:var(--text-tertiary);text-align:center;margin-bottom:32px">Access your API key, credits, and skill marketplace.</p>
    <div id="clerk-sign-in"></div>
    <div style="text-align:center;margin-top:24px;font-size:13px;color:var(--text-tertiary)">
      New here? <a href="#" id="sign-up-link" style="color:var(--accent)">Create an account</a>
    </div>
  </div>
</div>
```

### 3. Footer (shared, minimal)

---

## Remove Entirely
- Two-column split layout
- Feature list on the side
- Grid background (`body::before`)
- Glow effects
- IBM Plex Serif font

## Preserve
- Clerk integration: The `<div id="clerk-sign-in">` element where Clerk renders its sign-in UI
- Clerk script tag with publishable key
- Any redirect logic after sign-in (check current JS)

---

## Clerk Script
```html
<script data-clerk-publishable-key="pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA"
  src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js"></script>
<script>
  window.addEventListener('load', async () => {
    await window.Clerk.load();
    if (window.Clerk.user) {
      window.location.href = '/dashboard.html';
      return;
    }
    window.Clerk.mountSignIn(document.getElementById('clerk-sign-in'));
  });
</script>
```

---

## Verification Checklist

- [ ] Clerk sign-in widget renders
- [ ] Redirects to dashboard if already signed in
- [ ] Clean centered card layout
- [ ] No old design system remnants
- [ ] Mobile responsive
- [ ] Nav and footer present
