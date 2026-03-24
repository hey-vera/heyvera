# AID-Receipt — Open Concerns

> Concerns specific to Protocol 2 (DSIRs + commitment logs).
> These concerns are DEFERRED until AID-Trust has adoption.

## ORANGE

### O3: Commitment Log Completeness Depends on Cooperation
Both parties must maintain logs. Offline party = lost log. Bilateral collusion = undetectable omission. Liveness penalties (0.9x/0.5x) are empirically chosen. See master O3.

### O7: DSIR Chicken-and-Egg (Bilateral Receipts Need Two Parties)
DSIRs require two implementations. Currently only ClawNet exists. Protocol 2 only makes sense when Protocol 1 has external adopters generating two-party interactions. See master O7.

### O2: EigenTrust Convergence Under Adversarial Graphs
EigenTrust is a Protocol 2 feature (receipt-primary scoring). Designed but 0% built. Convergence behavior under adversarial structure is unknown. See master O2.

## YELLOW

### Receipt Format Lock-In Risk
Once DSIRs are adopted by external parties, the format becomes very hard to change. Schema evolution policy (additive minor, 6-month dual-support major) mitigates but doesn't eliminate. Early format decisions are high-stakes.

## NOT YET ACTIVE

These concerns activate when Protocol 2 development begins. Until then, they're documented but not monitored.
