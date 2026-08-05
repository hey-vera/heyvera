# Josh's queue, compressed

> Written 2026-08-05, corrected the same day. Four items were parked as
> "blocked on Josh." Fair challenge received: most of each is research and
> drafting an agent can do. That work is now done below, and the challenge
> shrank the list further — item 1 is mostly an authorization click, and
> item 2's first half turned out to be optional. What remains genuinely
> yours is the thin layer no agent should hold: sudo, signature, payment,
> and mail under your name. Estimated total: **~15 minutes.**

---

## 1. Unfreeze deploys — #411's host commands (~1 min of yours)

**Your part is the Tailscale authorization**, not the typing. Once the
agent's SSH access is authorized, it runs the sequence below itself. Only
the `/etc/cortex/cortex.env` line may bounce back to you if guardian's sudo
allowlist doesn't cover it — that single line is the entire fallback.

SSH to the VPS (`ssh guardian-vps-tail`), then, in order:

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

## 2. Anthropic — one message that matters, one optional (~5 min)

Correction to the earlier framing: **(b) is the real item; (a) is optional
insurance.** The Claude API exists to power products, and Cortex uses
operator-funded API keys — §D.4 restricts reselling model *access*, which
Cortex does not do. Nothing is blocked on (a). Its only lasting value is
having a written answer on file when an enterprise security review asks
whether you have provider authorization. Send it if you want the artifact;
skip it without cost.

Send via your Anthropic Console support/sales contact. Drafts; edit freely.

**a) Commercial terms comfort check — optional:**

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

**b) Rate limits — send this one:**

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

**What it is not:** it has nothing to do with ownership. Cortex is yours,
fully, certified or not. SOC 2 is a security report card *you commission
about your own company*. Big customers' procurement rules — their internal
policy, not law — forbid buying from vendors without one. That is the only
thing it unlocks.

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

## 5. Before the first dollar moves — entity, terms, Stripe (~1 hour, when payments get built)

Not urgent today; blocking the moment F2's ledger meets real money. Listed
so it is never a surprise:

- **Legal entity.** Stripe onboards a business identity, not a person, and
  customers need someone to contract with. Filing is yours; an agent can
  compare structures and pre-fill.
- **Terms of Service + privacy policy.** Customers accept *your* terms;
  they must cover the credit's non-refundability rules (CREDITS.md's refund
  policy is the source of truth — the ToS must not contradict it), data
  handling for the repo index (CONTEXT.md's embeddings caveat), and
  acceptable use. Agents draft; a lawyer's one-pass review before launch is
  cheap relative to the risk.
- **Stripe account + tax settings.** Yours to create; the integration is
  agent work once it exists.

---

*Standing division of labor this file encodes: agents research, draft, and
compress; Josh spends identity, money, and sudo. If an item on a future
"blocked on Josh" list can't be compressed to that thin layer, it wasn't
compressed hard enough.*
