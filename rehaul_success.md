# Rehaul: success.html

**Status:** NOT STARTED
**Current file:** `site/success.html` — 282 lines, old design system
**Complexity:** Low
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html`

---

## Overview

Post-purchase confirmation page. Shown after Stripe checkout redirects back. Displays the API key, credit amount, and quick-start instructions.

---

## Structure

### 1. Nav (shared)
No active link.

### 2. Centered Success Card
```html
<div style="display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 56px - 80px);padding:24px">
  <div class="card" style="max-width:520px;width:100%;padding:40px;text-align:center">
    <div style="width:48px;height:48px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
      <svg width="24" height="24" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h1 style="font-family:var(--font-display);font-size:24px;font-weight:600;color:var(--text-primary);margin-bottom:8px">Payment Successful</h1>
    <p style="font-size:14px;color:var(--text-tertiary);margin-bottom:24px">Your credits have been added to your account.</p>

    <div id="key-display" style="display:none;margin-bottom:24px">
      <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px">Your API Key</div>
      <div style="background:var(--bg-primary);border:1px solid var(--border-default);border-radius:var(--radius-md);padding:12px 16px;font-family:var(--font-mono);font-size:13px;color:var(--accent);display:flex;align-items:center;justify-content:space-between;gap:8px">
        <code id="api-key-text"></code>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px;flex-shrink:0" onclick="copyKey()">Copy</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Store this securely. You can also find it on your dashboard.</div>
    </div>

    <div id="credits-display" style="display:none;margin-bottom:24px">
      <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent)" id="credits-amount"></div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">credits added</div>
    </div>

    <div id="quickstart" style="display:none;text-align:left;margin-bottom:24px">
      <div style="font-size:12px;font-weight:500;color:var(--text-tertiary);margin-bottom:8px">Quick Start</div>
      <div class="code-block" style="background:var(--bg-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:16px;overflow-x:auto">
        <code id="curl-example" style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:pre"></code>
      </div>
    </div>

    <a href="/dashboard.html" class="btn btn-primary btn-lg" style="width:100%">Go to Dashboard</a>

    <div id="loading-state" style="padding:20px;color:var(--text-tertiary)">Loading your purchase details...</div>
    <div id="error-state" style="display:none;padding:20px;color:var(--danger)"></div>
  </div>
</div>
```

### 3. Footer (shared)

---

## Preserve

- Reading `session_id` from URL params to fetch purchase result
- Copy-to-clipboard JS for API key
- Redirect to dashboard logic
- Any Clerk session check

## Remove
- Spinning loader animation
- Pulsing effects
- Grid background
- IBM Plex Serif / Space Mono

---

## JS Logic
```javascript
const API = 'https://api.claw-net.org';

async function loadSuccess() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  if (!sessionId) {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('error-state').style.display = 'block';
    document.getElementById('error-state').textContent = 'No session ID found. Return to the dashboard.';
    return;
  }
  // Existing fetch logic to get purchase details from session_id
  // Preserve whatever the current success.html does here
}

function copyKey() {
  const key = document.getElementById('api-key-text').textContent;
  navigator.clipboard.writeText(key).then(() => toast('Copied!', 'success'));
}

loadSuccess();
```

---

## Verification Checklist

- [ ] Success state shows: checkmark, API key, credits, curl example
- [ ] Copy button works
- [ ] Loading and error states work
- [ ] Dashboard link works
- [ ] No old design system remnants
- [ ] Mobile responsive
