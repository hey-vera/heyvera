# AID-Settle — Open Concerns

> Concerns specific to Protocol 3 (trust-gated settlement).
> Full text lives here. Master file (docs/open-concerns.md) is the index + dependency map.
> These concerns are DEFERRED until AID-Receipt has adoption. Documented but not actively monitored.
> Updated: March 24, 2026.

---

## ORANGE

### O9: Regulatory Classification of Trust Scores

**The problem:** The plan's own Section 33.5 labels this CRITICAL. The trust API is literally called a "credit bureau endpoint." If trust scores determine pricing and access — which is AID-Settle's core function — they may trigger FCRA obligations (adverse action notices, dispute rights, accuracy obligations) or EU AI Act Annex III 5(b) high-risk classification (conformity assessments before deployment). Either would fundamentally change the protocol's openness.

**Why AID-Settle is the trigger:** AID-Trust computes scores. But AID-Settle is where scores are USED to deny discounts or require prepay. That's the action regulators care about — the scoring is the input, the pricing decision is the output that affects parties.

**What we've proposed:** Legal disclaimer, explain API, dispute mechanism, public scoring formula.

**Why this is ORANGE:** The mitigations are bets that regulators will accept them — not confirmed legal positions. No lawyer has reviewed any of this. Our own language ("credit bureau endpoint") invites scrutiny.

**What would help:** A single fintech attorney consultation ($500-2K) covering FCRA applicability.

---

### O10: Money Transmitter Risk

**The problem:** Collecting USDC from agents, keeping 15%, and paying 85% to creators may constitute money transmission under FinCEN. The plan calls this "HIGH RISK — exists TODAY" and notes operating as an unlicensed MSB is a federal crime. The "pull-based withdrawal" mitigation is "a legal theory — no authority has confirmed it works."

**Why this is ORANGE:** The revenue model itself creates the risk. Pull-based vs push-based payouts is an architectural choice with untested legal consequences. Five options listed (MSB registration, licensed partner, pull-based, smart contract, sandbox) — none confirmed. Wyoming DAO LLC sandbox research still unchecked.

---

## YELLOW

### Y3: USDC Pause Risk

**The problem:** Circle can pause USDC globally. All batched/deferred settlements fail. The 5% insurance reserve partially compensates but doesn't make agents whole.

**What we can do:** Detect pause (USDC.paused() check), revert to immediate mode, freeze batches. But we can't settle during a pause — that's Circle's unilateral power.

---

### Y4: Gas Price Volatility on Settlement

**The problem:** Settlement economics assume Base L2 gas at ~0.005 gwei ($0.001/tx). During congestion, gas can spike 100x+. The gas circuit breaker (pause at 10x 7-day average) helps but means settlement stops during spikes — exactly when high-volume events need it most.

**What we can do:** Circuit breaker, batch settlement, gas buffer. But we can't control Base gas prices. A $100/month budget becomes $10,000/month during sustained spike.

---

## NOT YET ACTIVE

These concerns activate when Protocol 3 development begins.

## CLOSED

*Nothing yet.*
