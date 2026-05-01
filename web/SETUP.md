# Setup Guide - First Time Dev

This guide is for a first-time vibe coder working on the HeyVera public
site.

Goal: get the page running locally, then use your AI assistant to build
one packet at a time.

Platform note:
- the command examples below were originally written for Windows
- Xotic is working on Linux
- on Linux, use forward-slash paths like `cd heyvera/web`
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

## Step 3: Use the active branch

For the current frontend workflow, use:

```powershell
git checkout feat/heyvera-web-scaffold-main
```

---

## Step 4: Install the landing page app

The landing page lives in `web/`.

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
- `web/.aider.conf.yml` auto-loads only the short durable files
- Aider will auto-run `npm run build` after edits

Before giving Aider a packet task, keep the read set small.

Recommended Aider setup for Packet 1:

```text
/read frontend-plan/PACKET-1-EXEC.md
/add src/App.tsx src/index.css
```

Then give a short prompt like:

```text
Build only Packet 1 from PACKET-1-EXEC.md. Stop after the packet.
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
- run `npm run proof`
- run `npm run status:update -- "Packet N" yes`
- explain what changed briefly
- push the branch
- stop for review

Important:
- a packet is not complete until the branch is pushed
- local commits alone are not the handoff point
- do not hand-edit commit hashes into `frontend-sync/STATUS.md`
- let `npm run status:update` write the live branch and commit

---

## Step 8: Save and push work

Check changes:

```powershell
git status
```

Commit:

```powershell
git add .
git commit -m "feat: complete packet work"
```

Push:

```powershell
git push origin feat/heyvera-web-scaffold-main
```

---

## What To Read Before Coding

Inside `web/`, these files matter most for actual model runs:
- `PRE-FLIGHT.md`
- `CONVENTIONS.md`
- `frontend-plan/XOTIC-WORKFLOW.md`
- `frontend-plan/AIDER-COMMANDS.md`
- `frontend-plan/DRIFT-RECOVERY.md`
- `frontend-plan/PACKET-1-EXEC.md`
- `frontend-plan/PACKET-2-EXEC.md`
- `frontend-plan/PACKET-3-EXEC.md`
- `frontend-sync/README.md`
- `frontend-sync/GIT-SYNC.md`

Use `frontend-plan/` as the source of truth for product direction.
Use `SETUP.md` as tooling guidance only.
Use `frontend-sync/` to record blockers, decisions, and packet status.

---

## Troubleshooting

### `npm run dev` starts the wrong thing

You are probably not inside the `web/` folder.

Check:

```powershell
pwd
```

### `aider` starts making weird unrelated changes

Tell it:

```text
Stop. Re-read the current PACKET-N-EXEC.md file. Build one packet only. Do not add dashboard UI, routes, pages, or extra sections.
```

### Qwen starts replacing real content with filler or fake values

Tell it:

```text
Make the smallest working edit only. Preserve existing structure and approved copy. Do not add placeholder text, fake commit hashes, fake branch names, routes, or pages. If you do not know an exact value, stop instead of inventing one.
```

### Qwen says a packet is done but the files do not show it

Run:

```powershell
npm run proof
```

If the printed `src/App.tsx` and `src/` file list do not clearly show
the packet work, the packet is not done yet.

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
| Proof a packet | `cd web && npm run proof` |
| Update status automatically | `cd web && npm run status:update -- "Packet N" yes` |
| Check branch | `git branch` |
| Check changes | `git status` |
| Push work | `git push origin feat/heyvera-web-scaffold-main` |
