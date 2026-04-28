# HeyVera Landing Page — AGENTS.md

<!-- Universal AI project memory. Works with any AI coding tool.
     Claude Code: reads this automatically.
     Aider: use `aider --read AGENTS.md`
     Other tools: paste this as context or tell your AI "read AGENTS.md first." -->

Public landing page for heyvera.org. React 19 + Vite + Tailwind CSS 4.
Static marketing site — no backend, no API, no database.

## What to Build

Read `BRIEF.md` in this directory for the full spec — page sections,
design guidelines, content copy, and file structure.

Read `SETUP.md` for environment setup instructions.

## Workflow

### Slices
Build one component at a time. Order matters — build top to bottom:
1. Project setup (Vite + React + Tailwind running)
2. Navbar
3. Hero section with terminal mockup
4. Features (3 columns)
5. How It Works (3 steps)
6. Community section
7. Get Started (email capture)
8. Footer
9. Mobile responsive pass
10. Polish (animations, spacing)

### Quality checks before every commit
- Page loads without console errors
- Looks correct on desktop (full width)
- Looks correct on mobile (dev tools device toggle)
- Code is in the right component file (not all in App.tsx)
- Slice works end-to-end before starting the next one

### Git rules
- Branch: `feat/landing-page`
- Commit after each working slice
- Message format: `feat: add hero section with terminal mockup`
- Push and create PR — Josh merges, site auto-deploys

## Stack Rules

| Use | NOT |
|---|---|
| React 19 + TypeScript | Plain HTML or other frameworks |
| Vite | Webpack, Create React App |
| Tailwind CSS 4 (utility classes) | Inline styles, CSS modules, styled-components |
| npm | yarn, pnpm |
| Component files in src/components/ | Everything in App.tsx |

## Design Rules

- Dark theme (#09090b background)
- ONE accent color (emerald #10b981 or pick one, stay consistent)
- Inter font for text, JetBrains Mono for code/terminal
- Large headlines with clamp() for responsive sizing
- Generous whitespace (120px section padding desktop, 80px mobile)
- No stock photos, no complex animations, no 3D effects

## File Structure

```
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
```

## What NOT to do

- Don't touch anything outside the web/ directory
- Don't add backend code, API calls, or database connections
- Don't install unnecessary packages — keep deps minimal
- Don't use CDN scripts — everything through npm
- Don't push to main — always use a branch and PR
