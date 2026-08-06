//! Binding a verdict to the ledger.
//!
//! Task **V4** of `cortex/plan/VERIFIER.md`, minus its persistence. Storing
//! verdicts needs migration v61 and is blocked behind the shared counter;
//! deciding what a verdict *does to money* is not, and it is the part worth
//! getting right first, because it is the part that can lose money in both
//! directions.
//!
//! Two failure modes this exists to make impossible:
//!
//! - **Double-charging.** The orchestrator retries by design (`max_attempts`,
//!   lease expiry requeues). A step that completes, charges, and then has its
//!   result rejected for a stale `lease_gen` will be re-run — and must not be
//!   charged twice.
//! - **Charging or refunding for our own outage.** An infrastructure failure
//!   is not a customer's problem, and it is equally wrong to bill them for it
//!   or to refund them work that was never done.

use serde::{Deserialize, Serialize};

use crate::verification::Verdict;

/// What a verdict does to the ledger.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BillingEffect {
    /// Charge the task's price. Key makes it exactly-once.
    Charge { idempotency_key: String },
    /// Return credits already taken. Only ever reached from a state that
    /// charged, so a refund can never precede a charge.
    Refund { idempotency_key: String },
    /// Touch nothing. Distinct from a zero-value charge: the ledger stays
    /// append-only and silent, so nothing has to be explained later.
    None,
}

/// Where a step's billing stands, so a transition can be decided from facts
/// rather than from whatever the caller remembers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingState {
    /// No ledger row exists for this verification.
    Unbilled,
    /// A charge has been written.
    Charged,
    /// A charge was written and then returned.
    Refunded,
}

/// Ledger reason codes. These are the strings CREDITS.md enumerates, kept in
/// one place so a receipt, an invoice line and a ledger row cannot drift into
/// describing the same event differently.
pub mod reason {
    pub const TASK_VERIFIED: &str = "task_verified";
    pub const TASK_FAILED_REFUND: &str = "task_failed_refund";
    pub const TASK_UNVERIFIED: &str = "task_unverified";
}

/// The charge key for a verification. Derived, never generated: replaying a
/// transition after a crash between verdict and ledger write must re-derive
/// the same key, so the ledger's `UNIQUE` constraint turns the retry into a
/// no-op instead of a second charge.
pub fn charge_key(verification_id: &str) -> String {
    format!("verify:{verification_id}")
}

/// The refund key. Separate namespace from the charge, so a refund cannot
/// collide with the charge it reverses and be silently dropped.
pub fn refund_key(verification_id: &str) -> String {
    format!("refund:{verification_id}")
}

/// Decide what this verdict does to the ledger, given what has already
/// happened to it.
///
/// The reasoning behind each row, since the table alone reads as arbitrary:
///
/// - **VERIFIED, unbilled** → charge. The work is done and proven.
/// - **VERIFIED, already charged** → nothing. This is the retry path, and the
///   idempotency key would make a second write a no-op anyway; returning
///   `None` means we do not depend on that backstop for correctness.
/// - **FAILED, charged** → refund. This is the promise that makes "verified"
///   the product rather than a marketing word.
/// - **FAILED, unbilled** → nothing. There is nothing to return, and writing
///   a zero-value row to record that would be noise in an append-only ledger.
/// - **INCONCLUSIVE, anything** → nothing, always. A dead runner must not
///   charge a customer *or* refund one; the run retries and the ledger never
///   learns this happened.
/// - **UNVERIFIED, unbilled** → charge, under its own reason code. The work is
///   sold at the normal rate without the badge and without the refund
///   promise, so it must be distinguishable in the ledger from verified work
///   — otherwise the refund rate looks wrong and nobody can explain why.
/// - **Anything, refunded** → nothing. A refunded verification is terminal;
///   re-charging it would need a new verification id, which a new attempt
///   mints anyway.
pub fn billing_effect(
    verdict: Verdict,
    state: BillingState,
    verification_id: &str,
) -> BillingEffect {
    match (verdict, state) {
        (_, BillingState::Refunded) => BillingEffect::None,
        (Verdict::Inconclusive, _) => BillingEffect::None,

        (Verdict::Verified, BillingState::Unbilled) => BillingEffect::Charge {
            idempotency_key: charge_key(verification_id),
        },
        (Verdict::Unverified, BillingState::Unbilled) => BillingEffect::Charge {
            idempotency_key: charge_key(verification_id),
        },
        (Verdict::Verified | Verdict::Unverified, BillingState::Charged) => BillingEffect::None,

        (Verdict::Failed, BillingState::Charged) => BillingEffect::Refund {
            idempotency_key: refund_key(verification_id),
        },
        (Verdict::Failed, BillingState::Unbilled) => BillingEffect::None,
    }
}

/// The ledger reason a verdict is written under.
pub fn ledger_reason(verdict: Verdict) -> Option<&'static str> {
    match verdict {
        Verdict::Verified => Some(reason::TASK_VERIFIED),
        Verdict::Unverified => Some(reason::TASK_UNVERIFIED),
        Verdict::Failed => Some(reason::TASK_FAILED_REFUND),
        Verdict::Inconclusive => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VID: &str = "ver_9f2c";

    #[test]
    fn a_verified_step_charges_once() {
        assert_eq!(
            billing_effect(Verdict::Verified, BillingState::Unbilled, VID),
            BillingEffect::Charge {
                idempotency_key: "verify:ver_9f2c".into()
            }
        );
    }

    #[test]
    fn a_retry_of_a_charged_verification_does_not_charge_again() {
        // The orchestrator retries by design. This is the double-charge the
        // whole idempotency scheme exists to prevent, and it is prevented
        // here rather than relying on the ledger's UNIQUE as a backstop.
        assert_eq!(
            billing_effect(Verdict::Verified, BillingState::Charged, VID),
            BillingEffect::None
        );
    }

    #[test]
    fn keys_are_derived_so_a_replay_reproduces_them() {
        assert_eq!(charge_key(VID), charge_key(VID));
        assert_eq!(refund_key(VID), refund_key(VID));
    }

    #[test]
    fn charge_and_refund_keys_never_collide() {
        // Sharing a namespace would let a refund be swallowed as a duplicate
        // of the charge it reverses.
        assert_ne!(charge_key(VID), refund_key(VID));
    }

    #[test]
    fn a_failure_after_a_charge_refunds() {
        assert_eq!(
            billing_effect(Verdict::Failed, BillingState::Charged, VID),
            BillingEffect::Refund {
                idempotency_key: "refund:ver_9f2c".into()
            }
        );
    }

    #[test]
    fn a_failure_with_nothing_charged_writes_nothing() {
        assert_eq!(
            billing_effect(Verdict::Failed, BillingState::Unbilled, VID),
            BillingEffect::None
        );
    }

    #[test]
    fn inconclusive_never_touches_the_ledger() {
        // Neither direction, in any state. Infra failures cost us time, not
        // customers money — and not customers' trust either.
        for state in [
            BillingState::Unbilled,
            BillingState::Charged,
            BillingState::Refunded,
        ] {
            assert_eq!(
                billing_effect(Verdict::Inconclusive, state, VID),
                BillingEffect::None,
                "inconclusive must be inert in state {state:?}"
            );
        }
        assert_eq!(ledger_reason(Verdict::Inconclusive), None);
    }

    #[test]
    fn unverified_work_is_charged_under_its_own_reason() {
        // Sellable at the normal rate, without the badge or the refund
        // promise — and distinguishable in the ledger, or the refund rate
        // looks wrong and nobody can explain why.
        assert!(matches!(
            billing_effect(Verdict::Unverified, BillingState::Unbilled, VID),
            BillingEffect::Charge { .. }
        ));
        assert_eq!(ledger_reason(Verdict::Unverified), Some("task_unverified"));
        assert_ne!(
            ledger_reason(Verdict::Unverified),
            ledger_reason(Verdict::Verified)
        );
    }

    #[test]
    fn a_refunded_verification_is_terminal() {
        for verdict in [Verdict::Verified, Verdict::Failed, Verdict::Unverified] {
            assert_eq!(
                billing_effect(verdict, BillingState::Refunded, VID),
                BillingEffect::None,
                "{verdict:?} must not re-charge a refunded verification"
            );
        }
    }

    #[test]
    fn a_refund_can_never_precede_a_charge() {
        // Exhaustive over the states that have not charged: no combination
        // reaches Refund. Stated as a test because the alternative is money
        // leaving without having arrived.
        for verdict in [
            Verdict::Verified,
            Verdict::Failed,
            Verdict::Inconclusive,
            Verdict::Unverified,
        ] {
            for state in [BillingState::Unbilled, BillingState::Refunded] {
                assert!(
                    !matches!(
                        billing_effect(verdict, state, VID),
                        BillingEffect::Refund { .. }
                    ),
                    "{verdict:?} in {state:?} must not refund"
                );
            }
        }
    }
}
