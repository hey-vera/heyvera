# Setup Guide — First Time Dev

This walks you through everything from zero to seeing your first
page in the browser. No experience needed.

---

## Step 1: Install the basics

You need three things installed. Open PowerShell or Terminal.

### Node.js (runs JavaScript)
```
winget install OpenJS.NodeJS.LTS
```
Close and reopen your terminal after installing. Check it worked:
```
node --version
```
Should print something like `v22.x.x`.

### Git (version control)
You probably already have this if you cloned the repo. Check:
```
git --version
```
If not installed:
```
winget install Git.Git
```

### Aider (AI coding assistant that talks to your Qwen model)
```
pip install aider-chat
```
If `pip` isn't found, install Python first:
```
winget install Python.Python.3.12
```
Then close/reopen terminal and run the pip install again.

---

## Step 2: Clone the repo

```
git clone https://github.com/hey-vera/heyvera.git
cd heyvera
```

---

## Step 3: Set up the web project

The landing page lives in the `web/` folder. First time only:

```
cd web
npm create vite@latest . -- --template react-ts
```
If it asks "Current directory is not empty, please choose": pick
"Ignore files and continue" or similar.

Then install Tailwind:
```
npm install tailwindcss @tailwindcss/vite
```

---

## Step 4: Run the dev server

```
npm run dev
```

Open the URL it shows (usually http://localhost:5173) in your browser.
You should see a basic React page. Every time you save a file, the
browser updates automatically.

**Keep this running in one terminal while you work.**

---

## Step 5: Start coding with Aider + Qwen

Open a SECOND terminal (keep the dev server running in the first one).

Make sure Ollama is running with your Qwen model:
```
ollama run qwen2.5-coder:14b
```
(If it loads, great — close it with `/bye`. We just needed to confirm
it's ready.)

Now start Aider in the web/ folder:
```
cd heyvera/web
aider --model ollama/qwen2.5-coder:14b
```

Tell Aider what to do:
```
> Read BRIEF.md and build the Navbar component first
```

Aider will:
- Read the file
- Generate code
- Show you the changes
- Ask if you want to apply them
- Auto-commit to git

After each change, check your browser — the page updates live.

---

## Step 6: Push your work

When you have something working and want to share it:

```
git checkout -b feat/landing-page
git push origin feat/landing-page
```

Then go to github.com/hey-vera/heyvera — GitHub will show a
"Create pull request" button. Click it, add a short description,
submit. Josh will review and merge.

After merge, the site auto-deploys to heyvera.org.

---

## Workflow cheat sheet

| Task | Command |
|---|---|
| Start dev server | `cd web && npm run dev` |
| Start AI assistant | `cd web && aider --model ollama/qwen2.5-coder:14b` |
| See your work | Open http://localhost:5173 in browser |
| Save progress | Aider auto-commits, or `git add . && git commit -m "description"` |
| Push to GitHub | `git push origin feat/landing-page` |
| Create PR | Go to GitHub, click "Create pull request" |

---

## Tips

- **Read BRIEF.md** — it has the full design spec for the landing page
- **Work one section at a time** — Navbar first, then Hero, then Features
- **Check the browser after every change** — seeing your work is the
  best way to learn
- **Don't worry about perfect code** — get it working first, clean up later
- **Ask Aider specific things** like "make the hero section with a dark
  background and the headline 'Your AI. Your Name. Your Sovereignty.'"
- **If Aider gives weird output**, try being more specific or saying
  "undo that" and trying a different approach
- **The old site** had a good design system — check git history
  (`site/index.html`) for color schemes and typography if you want
  reference

## Troubleshooting

**"npm not found"** — close and reopen your terminal after installing Node.js

**"aider not found"** — close and reopen your terminal after pip install

**Qwen is slow** — make sure Ollama is using your GPU, not CPU.
Run `ollama ps` to check. If it says CPU, check that your GPU drivers
are up to date. For AMD 9070 XT: may need `HSA_OVERRIDE_GFX_VERSION=11.0.0`

**Page is blank** — check the terminal running `npm run dev` for errors.
Usually a typo in the code — ask Aider to fix it.

**Git push rejected** — you might be trying to push to main. Create a
branch first: `git checkout -b feat/landing-page`
