# HeyVera Landing Page - Build Brief

## What is HeyVera?

HeyVera is building sovereign AI agents. Every person owns their own AI
agent - they name it, it runs on their hardware, and it gets smarter
from a shared intelligence network called Vera.

**Company:** HeyVera (`heyvera.org`)
**Protocol:** Soma (open identity protocol)
**AI:** Vera (shared intelligence network)
**Token:** `$SOMA` (future, Year 3+)

## What This Page Is

The public landing page at `heyvera.org`. First impression for everyone.
Simple, clean, modern. Think: Linear, Vercel, or Supabase style polish,
but with a stronger identity and a more distinct point of view.

Dark theme. Minimal. Professional. No clutter.

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS 4
- Cloudflare Pages deploy target
- No backend needed - this is a static marketing page

This project is already scaffolded. To run it:

```bash
cd web
npm install
npm run dev
```

Before building, also read:
- `CONTEXT.md`
- `PLAN.md`

## Deployment Reality

This landing page does **not** need heavy app architecture to handle
large traffic. It is a static frontend deployed to Cloudflare Pages,
which is the right fit for a marketing site that may get a lot of
visitors.

Deployment assumptions:
- Root directory: `web`
- Build command: `npm run build`
- Build output directory: `dist`

What "modern and scalable" means here:
- static assets
- fast local dev and build times
- clean component structure
- minimal dependencies
- responsive design
- easy future handoff to another frontend developer

What it does **not** mean here:
- adding auth
- adding server rendering
- adding API routes
- adding a database
- turning the landing page into a full-stack app

## Experience Bar

This page should be good enough to be seen by millions of people and
leave a strong impression on them.

That means:
- visually memorable
- easy to understand
- smooth on mobile
- fast to load
- clearly not a generic AI template

Future versions can add custom art, AI-assisted illustration, or richer
motion, but version 1 should already feel premium.

## Page Sections

### 1. Navigation Bar

- HeyVera logo (text is fine for now)
- Links: Features, How It Works, Community
- CTA button: "Get Started" -> `#get-started`

### 2. Hero Section

- Headline: "Your AI. Your Name. Your Sovereignty."
- Subheadline: "Own an AI agent that works for you. Powered by Vera's
  shared intelligence. Running on your hardware."
- CTA button: "Get Started"
- Terminal mockup showing:

```text
$ vera init
What's your agent's name? > Atlas
Atlas is ready.

$ vera
Atlas: What are we working on?
```

### 3. Three Features

**Own Your Agent**
- Your agent has a name, an identity, and a reputation
- It runs on your hardware
- Works offline. No subscription. No lock-in.

**Shared Intelligence**
- Vera learns from trust-verified work across the network
- Your agent queries Vera for knowledge - like asking a senior dev
- Your work makes the network smarter for everyone

**Open Weights**
- Vera's model is open from Day 1
- Community guilds train specialized capabilities
- Fork it, run it, own it

### 4. How It Works

Step 1: "Name your agent" - one command, five minutes
Step 2: "Start working" - your agent codes, writes, builds with you
Step 3: "Vera learns" - the network gets smarter from real work

### 5. Community / Guild Section

- "Built by people who use it"
- Guilds are communities that train Vera's capabilities through real work
- Join the founding guild - your work shapes Vera's intelligence

### 6. Get Started Section

- `id="get-started"`
- "Ready to own your AI?"
- Email signup form placeholder only
- Or: "Star us on GitHub" link

### 7. Footer

- HeyVera 2026
- Links: GitHub, X.com, Docs (placeholder)
- "Built with Soma protocol"

## Design Direction

This project had useful ClawNet-era visual instincts, but the product
story is now different. Reuse the good visual discipline, not the old
copy or old app architecture.

### Keep from old ClawNet work

- Dark theme near `#09090b`
- High-contrast white/gray text
- A single accent color used consistently
- Inter for body text and JetBrains Mono for code/terminal
- Large headline scale using `clamp(...)`
- Generous spacing between sections
- Clean terminal/code presentation
- A polished, deliberate feel - not a generic template

### Reuse carefully

- Stats-bar patterns only if they help the story
- Subtle grid, glow, or surface treatment
- Layout rhythm and section spacing

### Do not reuse

- Dashboard code
- Backend patterns
- Purple-heavy dashboard styling
- Ceremony, roster, enrollment, marketplace, or ClawNet product copy
- Overbuilt navs, nested menus, or app-shell thinking

## Core Design Rules

- Dark background
- One accent color
- Strong typography
- Plenty of breathing room
- Mobile first, then desktop polish
- Terminal mockup should feel believable
- Motion should be subtle and meaningful

## What Not To Do

- No complex 3D effects
- No stock photos
- No pricing page yet
- No auth flow
- No docs or blog section yet
- No backend or API wiring
- No unnecessary packages
- Do not put everything in `App.tsx`
- Do not treat this like a product dashboard

## File Structure

```text
web/
  src/
    App.tsx
    components/
      Navbar.tsx
      Hero.tsx
      Features.tsx
      HowItWorks.tsx
      Community.tsx
      GetStarted.tsx
      Footer.tsx
    index.css
  index.html
  package.json
  vite.config.ts
  tsconfig.json
```

## Workflow

Before writing UI code:
- Read `AGENTS.md`
- Read `CONTEXT.md`
- Read this `BRIEF.md`
- Read `PLAN.md`
- Read `SETUP.md`
- Inspect the existing `src/` scaffold
- Use old ClawNet materials for inspiration only

### Slices

Build one slice at a time. Confirm each slice works before moving on.

| Slice | What | Done when |
|---|---|---|
| 1 | Project setup | `npm run dev` shows the starter page |
| 2 | Navbar | Logo, links, CTA visible |
| 3 | Hero | Headline, subheadline, terminal mockup |
| 4 | Features | Three cards with clear copy |
| 5 | How It Works | Three-step section works |
| 6 | Community | Guild section added |
| 7 | Get Started | Waitlist / CTA section added |
| 8 | Footer | Footer added |
| 9 | Mobile responsive pass | Looks good on phone |
| 10 | Polish | Spacing, motion, final refinement |

### Quality checks before every commit

- Page loads without errors
- Looks right on desktop
- Looks right on mobile
- Code is in the right component file
- Slice works end-to-end before starting the next

### Git workflow

- Branch: `feat/landing-page`
- Commit after each working slice
- Use clear commit messages
- Push after 2-3 slices working together
- Josh reviews and merges

### If something breaks

- Use `git diff`
- Check the browser console
- Check the terminal output from `npm run dev`
- Ask the AI assistant with the exact error text
- Do not guess when the terminal is telling you the answer

## For the AI assistant

Read this file first. Then build one slice at a time.

Important context:
- `web/` is a standalone frontend app
- `npm run dev` in `web/` should start Vite
- This is a static landing page for Cloudflare Pages
- Reuse visual lessons from ClawNet where helpful, but do not reuse the
  old product framing or dashboard structure

Keep the code simple, clean, and easy for another developer to extend.
