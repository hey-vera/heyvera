# Rehaul: index.html — Complete Redesign

**Status:** COMPLETED
**Current file:** `site/index.html` — 1,234 lines
**Complexity:** Very High — complete visual redesign, not just variable swaps
**Goal:** Transform from "dark template with green accent" into a world-class developer platform landing page on par with Stripe, Linear, Resend, Neon

---

## Problem Statement

The current index.html has the correct CSS variables and fonts but **looks like a generic dark template**. It doesn't feel like a real product. Specific issues:

1. **Hero is weak** — Generic tagline, 4 buttons side-by-side looks cluttered, stat counters feel like a hackathon demo
2. **Sections all look identical** — Same padding, same card style, no visual hierarchy or rhythm
3. **Pricing is overwhelming** — 6 cards side-by-side, all look the same, hard to parse
4. **No social proof** — No logos, no testimonials, no trust signals
5. **No visual interest** — Flat dark background everywhere, no gradients, no depth, no motion
6. **Code example is good** — but hidden behind auto-rotating slides that most users won't see
7. **Too much above the fold** — Hero + stats + 4 buttons = information overload
8. **Contact form on landing page** — Should be its own page, not polluting the landing flow
9. **Balance checker on landing page** — Dashboard feature, not landing page feature

---

## Design Philosophy

**Inspiration:** Resend.com (dark, clean, code-forward) + Neon.tech (green accent, dev-focused) + Linear.app (information density, polish)

**Rules:**
- **Whitespace is a feature** — 60%+ of the page should be empty space
- **One accent color** — `#10b981` used sparingly: CTAs, hover states, code highlights. Never in body text
- **Typography does the heavy lifting** — Size, weight, and spacing create hierarchy. Not color
- **Every section earns its place** — If it doesn't build trust or drive conversion, cut it
- **Code speaks louder than words** — Show the API in action, don't describe it
- **Mobile-first thinking** — Must look great at 375px, not just "not broken"

---

## Architecture: 8 Chunks (execute in order)

### Chunk 1: `<head>`, CSS Design System, Nav, Hero
### Chunk 2: Social Proof Strip + "How It Works" Pipeline
### Chunk 3: Interactive API Demo (code-forward, tabbed languages)
### Chunk 4: Feature Grid (what makes ClawNet different)
### Chunk 5: Data Sources / Integrations
### Chunk 6: Pricing (simplified — 3 tiers + expandable + crypto)
### Chunk 7: Footer + Final CTA + USDC Modal
### Chunk 8: All JavaScript (nav, stats, API demo, pricing, USDC modal)

---

## Chunk 1: Head + CSS + Nav + Hero

### Head (keep existing meta tags, same fonts)
Keep all existing `<meta>`, OG tags, favicon links, Google Fonts (Inter + JetBrains Mono) unchanged.

### CSS Design System
Keep the existing `:root` variables block (lines 22-61) — already correct. Add these new classes:

```css
/* ── LAYOUT ── */
.container { max-width: 1140px; margin: 0 auto; padding: 0 24px; }
.section { padding: 100px 24px; }
.section-sm { padding: 64px 24px; }

/* ── TYPOGRAPHY — real hierarchy via size not color ── */
.heading-xl {
  font-family: var(--font-display);
  font-size: clamp(40px, 5vw, 64px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
  color: var(--text-primary);
}
.heading-lg {
  font-family: var(--font-display);
  font-size: clamp(28px, 3.5vw, 40px);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--text-primary);
}
.heading-md {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}
.body-lg { font-size: 18px; line-height: 1.65; color: var(--text-secondary); }
.body { font-size: 15px; line-height: 1.6; color: var(--text-secondary); }
.caption {
  font-size: 12px; font-weight: 500; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.08em;
}

/* ── HERO GRADIENT MESH (subtle, not hacky) ── */
.hero-bg {
  position: absolute; inset: 0; overflow: hidden; z-index: 0;
}
.hero-bg::before {
  content: '';
  position: absolute;
  width: 600px; height: 600px;
  top: -200px; right: -100px;
  background: radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.hero-bg::after {
  content: '';
  position: absolute;
  width: 500px; height: 500px;
  bottom: -200px; left: -100px;
  background: radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%);
  pointer-events: none;
}
```

### Nav
Keep the existing nav HTML (lines 517-540) **exactly as-is**. Only CSS tweak — slightly more blur:

```css
nav {
  /* same as current but increase blur */
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  background: rgba(10,10,11,0.8); /* slightly more transparent to show blur */
}
```

### Hero — COMPLETE REDESIGN

**Current problems:** 4 buttons (cluttered), stat counters (hackathon feel), small heading
**New design:** Massive heading, status pill, 2 CTAs only, real code snippet below

```html
<section class="hero" id="hero">
  <div class="hero-bg"></div>
  <div class="container" style="position:relative;z-index:1">
    <!-- Status pill (replaces stat counters) -->
    <div class="caption" style="margin-bottom:16px">
      <span style="display:inline-flex;align-items:center;gap:6px;background:var(--accent-dim);padding:4px 12px 4px 8px;border-radius:9999px;border:1px solid rgba(16,185,129,0.2)">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--accent)"></span>
        API Online — <span id="statEndpointCount">&mdash;</span> endpoints live
      </span>
    </div>

    <h1 class="heading-xl" style="max-width:700px;margin-bottom:20px">
      One query.<br>Any API.<br>One answer.
    </h1>
    <p class="body-lg" style="max-width:520px;margin-bottom:36px">
      ClawNet orchestrates 158+ blockchain, social, and market APIs into a single natural-language endpoint. No subscriptions — pay per query.
    </p>

    <!-- Only 2 CTAs, not 4 -->
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:48px">
      <a href="#pricing" class="btn btn-primary btn-lg">Get API Key</a>
      <a href="/docs.html" class="btn btn-ghost btn-lg">Documentation</a>
    </div>

    <!-- Hero code snippet — show the API in action -->
    <div class="hero-code">
      <div class="hero-code-header">
        <span style="display:flex;gap:5px">
          <span style="width:10px;height:10px;border-radius:50%;background:#3f3f46"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#3f3f46"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#3f3f46"></span>
        </span>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">terminal</span>
      </div>
      <pre class="hero-code-body"><span style="color:var(--text-muted)">$</span> curl -X POST https://api.claw-net.org/v1/orchestrate \
  -H <span style="color:var(--accent)">"X-API-Key: cn-your-key"</span> \
  -H <span style="color:var(--accent)">"Content-Type: application/json"</span> \
  -d <span style="color:var(--accent)">'{"query":"Analyze BONK: price, holders, risk score"}'</span>

<span style="color:var(--text-muted)">// Response (7.4s, 10 credits)</span>
{
  <span style="color:var(--accent)">"answer"</span>: <span style="color:#f59e0b">"BONK: 991K holders, LP locked, mint disabled..."</span>,
  <span style="color:var(--accent)">"riskScore"</span>: <span style="color:var(--info)">28</span>,
  <span style="color:var(--accent)">"creditsUsed"</span>: <span style="color:var(--info)">10</span>,
  <span style="color:var(--accent)">"stepsExecuted"</span>: <span style="color:var(--info)">4</span>
}</pre>
    </div>
  </div>
</section>
```

Hero CSS:
```css
.hero {
  position: relative;
  padding: 140px 0 80px;
  overflow: hidden;
}
.hero-code {
  max-width: 680px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.hero-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface-2);
}
.hero-code-body {
  padding: 20px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
  overflow-x: auto;
  margin: 0;
}
```

---

## Chunk 2: Social Proof Strip + How It Works

### Social Proof Strip (NEW — does not exist in current page)

Place immediately below hero. Muted, compact, trust-building.

```html
<section class="section-sm" style="border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle)">
  <div class="container" style="text-align:center">
    <p class="caption" style="margin-bottom:24px">Trusted infrastructure</p>
    <!-- Provider names (text only, no logos needed) -->
    <div style="display:flex;align-items:center;justify-content:center;gap:40px;flex-wrap:wrap;opacity:0.5">
      <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-tertiary)">Solana</span>
      <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-tertiary)">Helius</span>
      <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-tertiary)">CoinGecko</span>
      <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-tertiary)">DeFi Llama</span>
      <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-tertiary)">x402</span>
      <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-tertiary)">Stripe</span>
    </div>
    <!-- Metric strip -->
    <div style="display:flex;justify-content:center;gap:48px;margin-top:32px;flex-wrap:wrap">
      <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--text-primary)" id="proofEndpoints">&mdash;</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">API Endpoints</div></div>
      <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--text-primary)">99.9%</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Uptime</div></div>
      <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--text-primary)">&lt;8s</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Avg Response</div></div>
      <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--text-primary)">$0.001</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Per Credit</div></div>
    </div>
  </div>
</section>
```

### How It Works (refine layout)

```html
<section class="section" id="how-it-works">
  <div class="container">
    <p class="caption" style="margin-bottom:12px">How it works</p>
    <h2 class="heading-lg" style="margin-bottom:16px">Three steps. Zero configuration.</h2>
    <p class="body" style="max-width:520px;margin-bottom:48px">Send a natural language question. ClawNet handles API selection, parallel execution, and answer synthesis automatically.</p>

    <div class="pipeline">
      <div class="pipeline-step">
        <div class="pipeline-num">01</div>
        <h3 class="heading-md" style="margin-bottom:8px">Query</h3>
        <p class="body">Ask anything in plain English. No endpoint IDs, no parameter schemas, no API docs to read.</p>
      </div>
      <div class="pipeline-connector"></div>
      <div class="pipeline-step">
        <div class="pipeline-num">02</div>
        <h3 class="heading-md" style="margin-bottom:8px">Orchestrate</h3>
        <p class="body">AI maps your query to optimal endpoints, builds an execution plan, and runs steps concurrently.</p>
      </div>
      <div class="pipeline-connector"></div>
      <div class="pipeline-step">
        <div class="pipeline-num">03</div>
        <h3 class="heading-md" style="margin-bottom:8px">Answer</h3>
        <p class="body">Raw data from multiple sources synthesized into a scored, actionable analysis with exact cost.</p>
      </div>
    </div>
  </div>
</section>
```

Pipeline CSS:
```css
.pipeline { display: flex; align-items: flex-start; gap: 0; }
.pipeline-step {
  flex: 1; padding: 32px;
  background: var(--bg-surface); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg); transition: border-color 0.15s;
}
.pipeline-step:hover { border-color: var(--border-default); }
.pipeline-num {
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
  color: var(--accent); margin-bottom: 16px;
}
.pipeline-connector {
  width: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  padding-top: 48px; color: var(--text-muted);
}
.pipeline-connector::after { content: '→'; font-size: 18px; }
@media (max-width: 768px) {
  .pipeline { flex-direction: column; gap: 12px; }
  .pipeline-connector { width: auto; padding: 0; transform: rotate(90deg); }
}
```

---

## Chunk 3: Interactive API Demo

**Replace** auto-rotating slides with static tabbed code example (curl, JavaScript, Python).

```html
<section class="section" id="api" style="background:var(--bg-surface)">
  <div class="container">
    <p class="caption" style="margin-bottom:12px">API Reference</p>
    <h2 class="heading-lg" style="margin-bottom:16px">One endpoint. Infinite queries.</h2>
    <p class="body" style="max-width:520px;margin-bottom:40px">POST a natural language query. Receive structured analysis with confidence scores, risk assessments, and exact costs.</p>

    <div class="api-demo">
      <div class="api-tabs">
        <button class="api-tab active" onclick="showLang('curl',this)">cURL</button>
        <button class="api-tab" onclick="showLang('js',this)">JavaScript</button>
        <button class="api-tab" onclick="showLang('python',this)">Python</button>
      </div>
      <div class="api-panels">
        <div class="api-req">
          <div class="api-req-header">
            <span class="method-badge post">POST</span>
            <code style="font-size:12px;color:var(--text-secondary)">/v1/orchestrate</code>
            <button class="copy-sm" onclick="copyApiCode()">Copy</button>
          </div>
          <pre class="api-code" id="reqCode"></pre>
        </div>
        <div class="api-res">
          <div class="api-res-header">
            <span style="font-size:12px;color:var(--accent)">200 OK</span>
            <span style="font-size:11px;color:var(--text-muted)">7.4s · 10 credits</span>
          </div>
          <pre class="api-code">{
  <span class="c-key">"answer"</span>: <span class="c-str">"BONK: 991K holders, LP locked, mint disabled. Price -4.2% on $2.25M vol. X sentiment 0.72/1.0. Risk: low."</span>,
  <span class="c-key">"opportunityScore"</span>: <span class="c-num">62</span>,
  <span class="c-key">"riskScore"</span>: <span class="c-num">28</span>,
  <span class="c-key">"costBreakdown"</span>: {
    <span class="c-key">"creditsUsed"</span>: <span class="c-num">10</span>,
    <span class="c-key">"costUsd"</span>: <span class="c-num">0.010</span>
  },
  <span class="c-key">"metadata"</span>: {
    <span class="c-key">"stepsExecuted"</span>: <span class="c-num">4</span>,
    <span class="c-key">"endpointsUsed"</span>: [<span class="c-str">"solscan"</span>, <span class="c-str">"helius"</span>, <span class="c-str">"twitter"</span>, <span class="c-str">"coingecko"</span>],
    <span class="c-key">"durationMs"</span>: <span class="c-num">7404</span>
  }
}</pre>
        </div>
      </div>
    </div>
  </div>
</section>
```

API Demo CSS:
```css
.api-demo { max-width: 900px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-primary); }
.api-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-2); }
.api-tab { font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-muted); background: none; border: none; padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
.api-tab:hover { color: var(--text-secondary); }
.api-tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }
.api-panels { display: grid; grid-template-columns: 1fr 1fr; }
.api-req { border-right: 1px solid var(--border-subtle); }
.api-req-header, .api-res-header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); }
.api-code { padding: 20px 16px; font-family: var(--font-mono); font-size: 12px; line-height: 1.65; color: var(--text-secondary); margin: 0; white-space: pre; overflow-x: auto; }
.c-key { color: var(--accent); }
.c-str { color: #f59e0b; }
.c-num { color: var(--info); }
.method-badge.post { font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: var(--radius-sm); background: var(--accent-dim); color: var(--accent); text-transform: uppercase; }
.copy-sm { margin-left: auto; font-size: 11px; color: var(--text-muted); background: none; border: 1px solid var(--border-default); padding: 3px 8px; border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font-sans); }
.copy-sm:hover { color: var(--text-primary); border-color: var(--border-strong); }
@media (max-width: 768px) { .api-panels { grid-template-columns: 1fr; } .api-req { border-right: none; border-bottom: 1px solid var(--border-subtle); } }
```

JS for language tabs:
```javascript
const CODE_SNIPPETS = {
  curl: `curl -X POST https://api.claw-net.org/v1/orchestrate \\
  -H "X-API-Key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"Analyze BONK: price, holders, risk score"}'`,
  js: `const res = await fetch('https://api.claw-net.org/v1/orchestrate', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: 'Analyze BONK: price, holders, risk score'
  })
});
const data = await res.json();`,
  python: `import requests

res = requests.post(
    'https://api.claw-net.org/v1/orchestrate',
    headers={'X-API-Key': 'YOUR_KEY'},
    json={'query': 'Analyze BONK: price, holders, risk score'}
)
data = res.json()`
};
function showLang(lang, btn) {
  document.querySelectorAll('.api-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('reqCode').textContent = CODE_SNIPPETS[lang];
}
function copyApiCode() {
  const code = document.getElementById('reqCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector('.copy-sm');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
// Initialize with curl
document.addEventListener('DOMContentLoaded', () => showLang('curl', document.querySelector('.api-tab')));
```

---

## Chunk 4: Feature Grid (NEW — does not exist in current page)

6 feature cards in a 3x2 grid. Each card: icon + title + description.

```html
<section class="section" id="features">
  <div class="container">
    <p class="caption" style="margin-bottom:12px">Why ClawNet</p>
    <h2 class="heading-lg" style="margin-bottom:16px">Built for developers who ship.</h2>
    <p class="body" style="max-width:520px;margin-bottom:48px">Stop juggling API keys, rate limits, and data normalization. ClawNet handles the infrastructure so you can build products.</p>
    <div class="feature-grid">
      <div class="feature-card">
        <div class="feature-icon" style="color:var(--accent)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
        <h3 class="heading-md" style="margin:12px 0 6px">Natural Language API</h3>
        <p class="body">Ask any question in plain English. No endpoint docs, no parameter schemas. AI handles routing automatically.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon" style="color:var(--info)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
        <h3 class="heading-md" style="margin:12px 0 6px">Parallel Execution</h3>
        <p class="body">Queries fan out to multiple APIs concurrently. 4-6 data sources in under 8 seconds, not 30.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon" style="color:var(--warning)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></div>
        <h3 class="heading-md" style="margin:12px 0 6px">Pay Per Query</h3>
        <p class="body">No subscriptions, no monthly fees. Credits start at $0.001 each and never expire. Cache hits: 1 credit.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon" style="color:var(--purple)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
        <h3 class="heading-md" style="margin:12px 0 6px">Skill Marketplace</h3>
        <p class="body">Browse and purchase community-built skills. Or create and sell your own — earn 97% of every sale.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon" style="color:var(--accent)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <h3 class="heading-md" style="margin:12px 0 6px">Circuit Breakers</h3>
        <p class="body">Automatic failover when upstream APIs degrade. Queries route around problems — zero downtime.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon" style="color:var(--info)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
        <h3 class="heading-md" style="margin:12px 0 6px">x402 Native</h3>
        <p class="body">Built on the x402 micropayment protocol. As new providers join the network, your access expands automatically.</p>
      </div>
    </div>
  </div>
</section>
```

Feature grid CSS:
```css
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.feature-card { padding: 28px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); transition: border-color 0.15s; }
.feature-card:hover { border-color: var(--border-default); }
.feature-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
@media (max-width: 768px) { .feature-grid { grid-template-columns: 1fr; } }
```

---

## Chunk 5: Data Sources

Keep existing provider card data and JS logic (the fetch to `/v1/endpoints` that populates counts). Only restyle.

Use class names: `.source-grid`, `.source-card`, `.source-status`, `.source-name`, `.source-desc`, `.source-count`

```css
.source-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.source-card { padding: 20px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); transition: border-color 0.15s; }
.source-card:hover { border-color: var(--border-default); }
.source-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; margin-bottom: 10px; }
.source-status.live { color: var(--accent); }
.source-status.soon { color: var(--text-muted); }
.source-name { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.source-desc { font-size: 13px; color: var(--text-tertiary); line-height: 1.5; margin-bottom: 8px; }
.source-count { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
```

---

## Chunk 6: Pricing (SIMPLIFIED)

**Current:** 6 cards all look the same = decision paralysis
**New:** 3 highlighted tiers (Starter $5, Pro $50 featured, Scale $500). Other tiers in expandable `<details>`.

```css
.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 900px; margin: 0 auto; }
.pricing-card { padding: 32px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); display: flex; flex-direction: column; }
.pricing-card.featured { border-color: rgba(16,185,129,0.3); box-shadow: 0 0 0 1px rgba(16,185,129,0.08); position: relative; }
.pricing-badge { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 600; background: var(--accent); color: #000; padding: 3px 12px; border-radius: 9999px; white-space: nowrap; }
.pricing-tier { font-size: 14px; font-weight: 500; color: var(--text-tertiary); margin-bottom: 8px; }
.pricing-price { font-family: var(--font-mono); font-size: 36px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
.pricing-credits { font-family: var(--font-mono); font-size: 14px; color: var(--accent); margin-bottom: 4px; }
.pricing-bonus { font-size: 12px; color: var(--warning); margin-bottom: 20px; }
.pricing-features { list-style: none; margin-bottom: 24px; flex: 1; }
.pricing-features li { font-size: 13px; color: var(--text-secondary); padding: 6px 0; border-bottom: 1px solid var(--border-subtle); }
.pricing-features li::before { content: '✓'; color: var(--accent); font-size: 12px; font-weight: 700; margin-right: 8px; }
@media (max-width: 768px) { .pricing-grid { grid-template-columns: 1fr; max-width: 400px; } }
```

**CRITICAL — Stripe links to preserve exactly:**
- $5: `https://buy.stripe.com/fZufZigsDgva6HZ5Vk08g00`
- $20: `https://buy.stripe.com/aFa9AUekv0wcearerQ08g01`
- $50: `https://buy.stripe.com/5kQ5kE7W792I9UbabA08g02`
- $100: `https://buy.stripe.com/9B6aEY6S3en27M35Vk08g03`
- $500: `https://buy.stripe.com/28EeVeekv0wcaYf1F408g04`
- $1000: `https://buy.stripe.com/6oUdRab8j1Ag3vNerQ08g05`

USDC crypto card stays below pricing. Keep the USDC modal HTML + JS intact.

---

## Chunk 7: Final CTA + Footer + USDC Modal

### Remove from landing page:
- **Balance Checker** — dashboard feature, not landing page. Remove entirely.
- **Contact Form** — now its own page at `/contact-section.html`. Remove the form, replace with simple CTA link.

### Final CTA (replaces contact section):
```html
<section class="section-sm" style="text-align:center;border-top:1px solid var(--border-subtle)">
  <div class="container">
    <h2 class="heading-lg" style="margin-bottom:12px">Ready to build?</h2>
    <p class="body" style="max-width:480px;margin:0 auto 28px">Get your API key in seconds. Start making queries immediately.</p>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a href="#pricing" class="btn btn-primary btn-lg">Get API Key</a>
      <a href="/docs.html" class="btn btn-ghost btn-lg">Read the Docs</a>
      <a href="/contact-section.html" class="btn btn-ghost">Contact Us</a>
    </div>
  </div>
</section>
```

### Footer — keep existing HTML exactly (lines 935-951)

### USDC Modal — keep existing HTML + JS exactly (lines 463-514, 1067-1158)
Preserve wallet address: `H6xbRyGEyoTdfBEShSt2H3oHJxL3gaJjVGdL5MLKwHN7`
Preserve USDC tiers: `{ 20:23000, 50:59000, 100:123000, 500:660000, 1000:1430000 }`
Preserve CARD tiers: `{ 5:5000, 20:21000, 50:54000, 100:112000, 500:600000, 1000:1300000 }`

---

## Chunk 8: All JavaScript

Consolidate JS into one `<script>` block. Include:

1. **initNav()** — Clerk auth state (keep existing logic)
2. **navSignOut()** — sign out (keep existing)
3. **refreshCredits()** — fetch /v1/auth/me (keep existing)
4. **fetchApiStatus()** — poll /health every 60s (keep existing)
5. **showLang() + copyApiCode()** — API demo tab switcher (NEW)
6. **Data Sources fetch** — populate provider counts from /v1/endpoints (keep existing)
7. **USDC Modal** — complete Phantom payment flow (keep existing)

### REMOVE from JS:
- Contact form validation/submission (separate page now)
- Balance checker (dashboard feature)
- Hero stat counter animation (no more stat counters)
- API slide auto-rotation (replaced by static tabs)

### Clerk script tag — preserve exactly:
```html
<script data-clerk-publishable-key="pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA"
  src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  onload="initNav()"></script>
```

---

## Execution Instructions for Sonnet

### Order of operations:
1. Read entire `site/index.html` first
2. Write Chunk 1 (head + CSS + nav + hero) — this replaces the entire file structure
3. Edit to add Chunk 2 (social proof + pipeline)
4. Edit to add Chunk 3 (API demo)
5. Edit to add Chunk 4 (features)
6. Edit to add Chunk 5 (data sources)
7. Edit to add Chunk 6 (pricing with Stripe links)
8. Edit to add Chunk 7 (final CTA + footer + USDC modal HTML)
9. Edit to add Chunk 8 (all JS + Clerk script)
10. Verify no broken HTML

### NEVER change:
- Stripe payment links (they are live production links receiving real money)
- Solana wallet address
- USDC tier pricing data
- Clerk publishable key
- API base URL (`https://api.claw-net.org`)

### Quality checklist:
- [ ] Hero: massive heading (clamp 40-64px), status pill, 2 CTAs, code snippet
- [ ] Social proof: provider names + 4 metrics
- [ ] Pipeline: 3 cards with → connectors, stacks on mobile
- [ ] API demo: tabbed (curl/JS/Python), copy button, split request/response
- [ ] Features: 6 cards in 3x2 grid with SVG icons
- [ ] Sources: dynamic counts from /v1/endpoints, live/soon badges
- [ ] Pricing: 3 main tiers, "Most Popular" highlighted, others expandable
- [ ] USDC card with modal preserved
- [ ] Final CTA before footer
- [ ] No balance checker, no contact form (both removed)
- [ ] All Stripe links preserved
- [ ] All USDC logic preserved
- [ ] Clerk auth in nav working
- [ ] API status dot working
- [ ] Mobile responsive at 375px
- [ ] No #00ff88, IBM Plex Serif, Space Mono, grid background, noise texture
