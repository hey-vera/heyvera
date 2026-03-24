# AID-Settle — Open Concerns

> Concerns specific to Protocol 3 (trust-gated settlement).
> These concerns are DEFERRED until AID-Receipt has adoption.

## ORANGE

### O9: Regulatory Classification of Trust Scores
Trust-gated pricing is WHERE the regulatory risk materializes. AID-Trust computes scores; AID-Settle uses them to deny discounts or require prepay. That's the action that triggers FCRA / EU AI Act scrutiny. See master O9.

### O10: Money Transmitter Risk
The 85/15 creator split + USDC payouts are settlement-layer concerns. Pull-based withdrawal is untested legal theory. See master O10.

## YELLOW

### Y3: USDC Pause Risk
Circle can pause USDC. Batched/deferred settlements fail. See master Y3.

### Y4: Gas Price Volatility
Settlement economics assume 0.005 gwei. Spikes break the model. See master Y4.

## NOT YET ACTIVE

These concerns activate when Protocol 3 development begins.
