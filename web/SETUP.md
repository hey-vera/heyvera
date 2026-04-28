# Setup Guide - First Time Dev

This guide is for a first-time vibe coder working on the HeyVera landing
page.

Goal: get the page running locally, then use your AI assistant to build
one section at a time.

---

## Step 1: Install the basics

You need:
- Node.js
- Git
- Aider
- Ollama with Qwen coder

### Node.js

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen your terminal, then check:

```powershell
node --version
```

### Git

```powershell
git --version
```

If missing:

```powershell
winget install Git.Git
```

### Python + Aider

If Python is not installed:

```powershell
winget install Python.Python.3.12
```

Then install Aider:

```powershell
pip install aider-chat
```

Check it worked:

```powershell
aider --version
```

---

## Step 2: Clone the repo

```powershell
git clone https://github.com/hey-vera/heyvera.git
cd heyvera
```

---

## Step 3: Create your branch

Do this before making changes:

```powershell
git checkout -b feat/landing-page
```

---

## Step 4: Install the landing page app

The landing page lives in `web/` and is already scaffolded.

```powershell
cd web
npm install
```

---

## Step 5: Start the dev server

```powershell
npm run dev
```

Open the local URL shown in the terminal, usually:

```text
http://localhost:5173
```

You should see the starter page.

Keep this terminal running.

---

## Step 6: Start your AI assistant

Open a second terminal.

Check Ollama:

```powershell
ollama run qwen2.5-coder:14b
```

If it opens, exit with:

```text
/bye
```

Then start Aider inside `web/`:

```powershell
cd heyvera\web
aider --model ollama/qwen2.5-coder:14b --read AGENTS.md
```

First prompt to give Aider:

```text
Read AGENTS.md, CONTEXT.md, BRIEF.md, PLAN.md, and SETUP.md.
Then build only Slice 2: the Navbar. Explain what you changed.
```

---

## Step 7: Work slice by slice

Do not try to build the whole page in one shot.

Recommended order:
1. Navbar
2. Hero
3. Features
4. How It Works
5. Community
6. Get Started
7. Footer
8. Mobile pass
9. Polish

After each slice:
- check the page in the browser
- make sure nothing broke
- commit working progress

---

## Step 8: Save and push work

Check changes:

```powershell
git status
```

Commit:

```powershell
git add .
git commit -m "feat: add navbar slice"
```

Push:

```powershell
git push origin feat/landing-page
```

Then create a pull request on GitHub.

---

## What To Read Before Coding

Inside `web/`, these files matter most:
- `AGENTS.md`
- `CONTEXT.md`
- `BRIEF.md`
- `PLAN.md`

Use them as the source of truth.

---

## Troubleshooting

### `npm run dev` starts the wrong thing

You are probably not inside the `web/` folder.

Check:

```powershell
pwd
```

You should be in:

```text
...\heyvera\web
```

### `node` or `npm` not found

Close and reopen the terminal after installing Node.

### `aider` not found

Close and reopen the terminal after installing it.

### Qwen is slow

Check whether Ollama is using GPU:

```powershell
ollama ps
```

If it says CPU, fix your Ollama/GPU setup first.

### The page is blank

- read the terminal error
- open browser dev tools
- ask the AI assistant to fix the exact error

### Aider starts making weird unrelated changes

Tell it:

```text
Stop. Only work inside web/. Read PLAN.md again. Build one slice only.
```

---

## Quick Commands

| Task | Command |
|---|---|
| Start page | `cd web && npm run dev` |
| Start AI helper | `cd web && aider --model ollama/qwen2.5-coder:14b --read AGENTS.md` |
| Check branch | `git branch` |
| Check changes | `git status` |
| Push work | `git push origin feat/landing-page` |
