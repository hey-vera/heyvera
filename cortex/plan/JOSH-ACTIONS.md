# Josh's queue, compressed

> Written 2026-08-05. Four items were parked as "blocked on Josh." Fair
> challenge received: most of each is research and drafting an agent can do.
> That work is now done below. What remains genuinely yours is the thin
> layer no agent should hold: your sudo password, your signature, your
> payment method, and emails sent under your name. Estimated total: **under
> 30 minutes.**

---

## 1. Unfreeze deploys — run #411's host commands (~5 min)

SSH to the VPS (`ssh guardian-vps-tail`), then paste, in order:

```bash
sudo mkdir -p /var/lib/cortex && sudo chown guardian:guardian /var/lib/cortex
sudo systemctl stop cortex
mv /home/guardian/claw-net/.cortex/cortex.db* /var/lib/cortex/
mv /home/guardian/claw-net/.cortex/ledger.jsonl /var/lib/cortex/
printf 'CORTEX_DB_PATH=/var/lib/cortex/cortex.db\nCORTEX_LEDGER_PATH=/var/lib/cortex/ledger.jsonl\n' | sudo tee -a /etc/cortex/cortex.env
sudo systemctl start cortex
```

Then on GitHub: open PR #411 → "Ready for review" → merge. **Order is
load-bearing** (host first, merge second — the PR explains why). A backup
already exists at `/home/guardian/backups/pre-dbmove/cortex_20260802_035217.db`.

## 2. Anthropic — two short messages (~10 min)

Send via your Anthropic Console support/sales contact. Drafts; edit freely.

**a) Commercial terms comfort check:**

> Subject: Confirming §A.1 posture for a product built on the Claude API
>
> Hi — I operate Cortex, a coding-agent product built on the Claude API
> under operator-funded API keys. Customers buy prepaid credits denominated
> in completed, verified engineering tasks — never in tokens or model
> access; token costs are internal COGS and are not resold or quoted to
> users. My reading is that this sits squarely within §A.1 ("power products
> and services…") rather than §D.4's resale restriction, and the product
> was designed specifically to stay on the right side of that line. Could
> you confirm that understanding, or point me to anything you'd want
> structured differently? Happy to share schema-level detail.

**b) Rate limits:**

> Subject: Spend-cap / tier increase request
>
> Same product as above. We're pre-launch; agentic coding workloads mean
> spiky, bursty usage at launch (a good launch day resembles a usage
> anomaly). I'd like to start the tier-increase conversation early rather
> than hit caps with live customers: what's the path to a higher monthly
> spend cap and acceleration-limit headroom on our org?

## 3. UNVERIFIED pricing row — a yes/no (~1 min)

VERIFIER.md sells tasks with no derivable checks as labeled **UNVERIFIED**:
normal credit price, no verified badge, no refund promise.
**Recommendation: approve.** It preserves revenue on legitimate work
(docs, exploration), keeps "verified" meaning something, and the refund
economics stay clean. The alternative — refusing such tasks — donates that
work to competitors. Reply "approved" (or object) and the row unblocks.

## 4. SOC 2 — the clock, demystified (~15 min when triggered)

**What it actually is:** an auditor attests your controls (access, change
management, incident response) over a window. Type I = point in time
(~2–3 months away once started); Type II = observed over 3–6 months —
that observation window is the "clock" that can't be compressed, which is
the entire reason to start before the first enterprise deal, not during it.

**What only you can do:** create the account, connect billing, sign the
auditor engagement. ~1 hour total, spread out.

**What agents then do (the other ~90%):** policy drafting, evidence
wiring (GitHub/cloud integrations), control remediation across the repo —
all of it agent-shaped work once the platform account exists.

**Concrete path:** a compliance-automation platform (Vanta is the default
recommendation for a company this size; Drata is the credible alternative —
have the agent doing setup compare current pricing), then their auditor
marketplace for the engagement. Ballpark: $10–20k/yr platform +
$7–15k audit.

**Trigger, so this isn't premature:** start when the first Team-tier
customer pays or the first enterprise inquiry lands — whichever comes
first. Until then it's a line item, not a task.

---

*Standing division of labor this file encodes: agents research, draft, and
compress; Josh spends identity, money, and sudo. If an item on a future
"blocked on Josh" list can't be compressed to that thin layer, it wasn't
compressed hard enough.*
