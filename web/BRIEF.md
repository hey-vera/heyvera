# HeyVera Landing Page — Build Brief

## What is HeyVera?

HeyVera is building sovereign AI agents. Every person owns their own AI
agent — they name it, it runs on their hardware, and it gets smarter
from a shared intelligence network called Vera.

**Company:** HeyVera (heyvera.org)
**Protocol:** Soma (open identity protocol)
**AI:** Vera (shared intelligence network)
**Token:** $SOMA (future, Year 3+)

## What This Page Is

The public landing page at heyvera.org. First impression for everyone.
Simple, clean, modern. Think: Linear, Vercel, or Supabase landing pages.

Dark theme. Minimal. Professional. No clutter.

## Tech Stack

- React 19 + TypeScript
- Vite (build tool)
- Tailwind CSS 4
- No backend needed — this is a static marketing page

To set up:
```
cd web
npm create vite@latest . -- --template react-ts
npm install tailwindcss @tailwindcss/vite
npm run dev
```

## Page Sections (top to bottom)

### 1. Navigation Bar
- HeyVera logo (text for now: "HeyVera" in bold)
- Links: Features, How It Works, Community
- CTA button: "Get Started" (links to #get-started)

### 2. Hero Section
- Headline: "Your AI. Your Name. Your Sovereignty."
- Subheadline: "Own an AI agent that works for you. Powered by Vera's
  shared intelligence. Running on your hardware."
- CTA button: "Get Started" (large, prominent)
- Terminal mockup showing:
  ```
  $ vera init
  What's your agent's name? > Atlas
  Atlas is ready.

  $ vera
  Atlas: What are we working on?
  ```

### 3. Three Features (3 columns)
Column 1: "Own Your Agent"
- Your agent has a name, an identity, and a reputation
- It runs on your hardware — you own the model weights
- Works offline. No subscription. No lock-in.

Column 2: "Shared Intelligence"
- Vera learns from trust-verified work across the network
- Your agent queries Vera for knowledge — like asking a senior dev
- Your work makes the network smarter for everyone

Column 3: "Open Weights"
- Vera's model is open from Day 1
- Community guilds train specialized capabilities
- Fork it, run it, own it — real open source

### 4. How It Works (3 steps)
Step 1: "Name your agent" — one command, 5 minutes
Step 2: "Start working" — your agent codes, writes, builds with you
Step 3: "Vera learns" — the network gets smarter from real work

### 5. Community / Guild Section
- "Built by people who use it"
- Guilds are communities that train Vera's capabilities through real work
- Join the founding guild — your work shapes Vera's intelligence

### 6. Get Started Section (id="get-started")
- "Ready to own your AI?"
- Email signup form (just captures email for waitlist — no backend yet,
  can be a simple form that doesn't submit)
- Or: "Star us on GitHub" link

### 7. Footer
- HeyVera 2026
- Links: GitHub, X.com, Docs (placeholder)
- "Built with Soma protocol"

## Design Guidelines

This project had a previous landing page (ClawNet era). The design 
system was good. Keep what worked, drop what didn't.

**Keep from the old site (in git history: site/index.html):**
- Dark theme with CSS custom properties (--bg-primary: #09090b)
- Emerald green accent (#10b981) — or pick a fresh accent if you prefer
- Inter font for body + JetBrains Mono for code/terminal
- Typography scale: heading-xl (clamp 42-68px), heading-lg, heading-md
- Generous section padding (120px vertical on desktop, 80px mobile)
- Stats bar pattern (live numbers in a horizontal strip)
- Responsive breakpoints already defined
- Professional, polished feel — not a template, not a toy

**Drop from the old site:**
- Single 1,383-line HTML file — use React components instead
- CDN Tailwind — use proper Tailwind 4 with Vite plugin
- Inline styles mixed with Tailwind mixed with custom CSS — pick ONE
  approach (Tailwind utility classes) and stick with it
- All ClawNet/agent marketplace copy — completely different product now
- Over-engineered dropdown menus and nested navs — keep nav simple

**Core design rules:**
- Dark background (#09090b or similar near-black)
- White/light gray text for readability
- ONE accent color used consistently
- Generous whitespace between sections
- Large typography for headlines (use clamp for responsive sizing)
- Subtle animations OK (fade-in on scroll) but don't overdo it
- Mobile responsive — single column on small screens
- Terminal mockup should look like a real terminal (dark bg, JetBrains
  Mono font, colored prompt)

## What NOT to do

- No complex animations or 3D effects
- No stock photos
- No pricing page yet
- No login/signup flow yet (just a waitlist email capture)
- No blog or docs section yet
- Don't connect to any backend or API
- Don't use CDN scripts — everything through npm/Vite
- Don't put everything in one file — use the component structure below

## File Structure

```
web/
  src/
    App.tsx          (main page layout)
    components/
      Navbar.tsx
      Hero.tsx
      Features.tsx
      HowItWorks.tsx
      Community.tsx
      GetStarted.tsx
      Footer.tsx
    index.css        (Tailwind imports + custom styles)
  index.html
  package.json
  vite.config.ts
  tsconfig.json
```

## Workflow — How to Build This

### Slices (one piece at a time)
Don't build the whole page at once. Each slice is one component that
works on its own. Build, test, commit, move on.

| Slice | What | Done when |
|---|---|---|
| 1 | Project setup (Vite + React + Tailwind running) | `npm run dev` shows a page |
| 2 | Navbar component | Logo + links + CTA button visible |
| 3 | Hero section | Headline + subheadline + terminal mockup |
| 4 | Features (3 columns) | Three cards with icons and text |
| 5 | How It Works (3 steps) | Step 1-2-3 layout |
| 6 | Community section | Guild description + CTA |
| 7 | Get Started section | Email capture form |
| 8 | Footer | Links + copyright |
| 9 | Mobile responsive | Everything looks good on phone |
| 10 | Polish | Animations, spacing, final tweaks |

### Quality checks (before every commit)
- Does the page load without errors? (check browser console)
- Does it look right on desktop? (full width browser)
- Does it look right on mobile? (browser dev tools, toggle device)
- Is the code in the right component file? (not all in App.tsx)
- Did you test the slice end-to-end before moving to the next?

### Git workflow
- Create ONE branch for all landing page work: `feat/landing-page`
- Commit after each working slice (not after every tiny change)
- Write clear commit messages: "feat: add hero section with terminal mockup"
- Push and create a PR when you have 2-3 slices working together
- Josh reviews and merges → site auto-deploys to heyvera.org

### If something breaks
- Don't panic — git has your history
- `git diff` shows what changed
- `git checkout -- filename` undoes changes to one file
- Ask your AI assistant: "the page is broken, here's the error: [paste error]"
- If totally stuck, push what you have and ask Josh for help

## For the AI assistant

If you're an AI helping build this page: read this entire file first.
Build one SLICE at a time (see table above). Start with Slice 1 
(project setup), confirm it works, then move to Slice 2 (Navbar).
Never skip ahead. Show the developer what you're doing as you go.
Keep the code simple and clean — this developer is learning.

After each slice, run through the quality checks above before 
committing. If something doesn't look right, fix it before moving on.
