# HeyVera Landing Page - AGENTS.md

Universal AI project memory for the `web/` landing page.

If you are an AI assistant working in this folder, read these files in
this order before writing code:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `BRIEF.md`
4. `PLAN.md`
5. `SETUP.md`

## Project Type

Static marketing site for `heyvera.org`.

Stack:
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Cloudflare Pages

This is **not** a backend app.
This is **not** a dashboard.
This is **not** a product shell.

## Mission

Build a landing page that makes HeyVera feel:
- real
- premium
- memorable
- easy to understand
- aligned with the actual Vera vision

The page should be clean enough for a first release and strong enough
to impress a lot of people. Avoid generic AI startup styling.

## Product Guardrails

Stay aligned with the current vision:
- HeyVera helps people own AI agents
- Vera is a shared intelligence layer, not a chatbot product
- Soma is the trust protocol underneath
- sovereignty, proof, and shared learning matter
- do not promise features that are not part of Day 0

Do not invent:
- enterprise features
- live dashboards
- magical autonomy claims
- agent marketplace flows
- pricing pages
- unsupported product claims

## Design Guardrails

- Dark theme
- Strong typography
- One accent color
- Clean terminal-inspired details
- Mobile responsive
- Minimal dependencies
- Code split into components

Avoid:
- template-looking AI SaaS sections
- purple dashboard aesthetics
- heavy animations
- stock photos
- clutter

## Workflow

Build one slice at a time.

Order:
1. Project setup sanity check
2. Navbar
3. Hero
4. Features
5. How It Works
6. Community
7. Get Started
8. Footer
9. Mobile polish
10. Final visual polish

After each slice:
- run the page
- check for console errors
- verify mobile layout
- keep files organized

## Rules For AI Assistants

- Read all planning docs before coding
- Do not rewrite the whole app when only one slice is requested
- Do not install unnecessary packages
- Do not touch anything outside `web/`
- Do not add backend code or APIs
- Do not replace the stack
- Do not make product claims that are not supported by `CONTEXT.md`

## If You Get Stuck

- Read the current error output
- Check the browser
- Re-read `PLAN.md`
- Make the smallest correction needed
- If uncertain, ask the human for the exact decision instead of guessing
