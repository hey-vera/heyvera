# Setup Guide - First Time Dev

This guide is for a first-time vibe coder working on the HeyVera public
site.

Goal: get the page running locally, then use your AI assistant to build
one packet at a time.

Platform note:
- the command examples below were originally written for Windows
- Xotic is working on Linux
- on Linux, use your distro package manager for installs and use
  forward-slash paths like `cd heyvera/web`
- the product and workflow guidance stays the same across platforms

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
cd heyvera/web
aider --model ollama/qwen2.5-coder:14b
```

Why this is shorter now:
- `web/.aider.conf.yml` auto-loads the read-only planning files
- Aider will also auto-run `npm run build` after edits

First prompt to give Aider:

```text
Build only Packet 1. Do not build anything related to the signed-in app. Explain what you changed and stop.
```

---

## Step 7: Work packet by packet

Do not try to build the whole page in one shot.

Recommended order:
1. Packet 1: foundation
2. Packet 2: core public sections
3. Packet 3: supporting public sections and mobile polish
4. Stop for review

After each packet:
- check the page in the browser
- make sure nothing broke
- explain what changed
- stop for review if the packet is complete

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
- `frontend-plan/README.md`
- `frontend-plan/MASTER-PLAN.md`
- `frontend-plan/PUBLIC-SITE.md`
- `frontend-plan/EXECUTION-PACKETS.md`
- `frontend-plan/XOTIC-WORKFLOW.md`
- `frontend-sync/README.md`
- `frontend-sync/GIT-SYNC.md`

Use `frontend-plan/` as the source of truth for product direction.
Use `SETUP.md` as tooling guidance only.
Use `frontend-sync/` to record blockers, decisions, and packet status.
Use `frontend-sync/GIT-SYNC.md` for fetch/pull discipline.

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
Stop. Only work inside web/. Re-read frontend-plan/PUBLIC-SITE.md and EXECUTION-PACKETS.md. Build one packet only. Do not add dashboard UI or extra sections.
```

### Qwen wants to improvise product or design decisions

Tell it:

```text
Do not invent product truth. Use the docs as ground truth. Keep the current packet structurally simple.
```

### Qwen needs internet context

Assume it does not have reliable web access by default.

If needed:
- give it exact URLs
- or paste the exact source text

Do not ask it to research the product direction for you.

---

## Quick Commands

| Task | Command |
|---|---|
| Start page | `cd web && npm run dev` |
| Start AI helper | `cd web && aider --model ollama/qwen2.5-coder:14b` |
| Check branch | `git branch` |
| Check changes | `git status` |
| Push work | `git push origin feat/landing-page` |
