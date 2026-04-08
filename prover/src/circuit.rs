//! Pulse fold step circuit for Nova IVC.
//!
//! Proves: each Pulse Tree leaf was correctly folded into the running state.
//! Uses BN254 scalar field for EVM-compatible Groth16 proofs.
//!
//! Step function: new_state = (prev_state * leaf_hash + heartbeat_index + 1)^5
//! ~6 R1CS constraints per fold. The x^5 power map (Rescue-style) provides
//! algebraic non-linearity — soundness comes from the SNARK, not collision resistance.

use ark_ff::PrimeField;
use ark_r1cs_std::{alloc::AllocVar, fields::fp::FpVar, fields::FieldVar};
use ark_relations::gr1cs::{ConstraintSystemRef, Namespace, SynthesisError};
use core::marker::PhantomData;
use std::borrow::Borrow;

use folding_schemes::{frontend::FCircuit, Error};

// ─── External Inputs ─────────────────────────────────────────────────────

/// Per-step inputs from the Pulse Tree: the leaf hash and heartbeat index.
/// These are private witnesses — not part of the public IVC state.
#[derive(Clone, Debug)]
pub struct PulseFoldInputs<F: PrimeField> {
    pub leaf_hash: F,
    pub heartbeat_index: F,
}

impl<F: PrimeField> Default for PulseFoldInputs<F> {
    fn default() -> Self {
        Self {
            leaf_hash: F::zero(),
            heartbeat_index: F::zero(),
        }
    }
}

/// In-circuit allocated version of PulseFoldInputs.
#[derive(Clone, Debug)]
pub struct PulseFoldInputsVar<F: PrimeField> {
    pub leaf_hash: FpVar<F>,
    pub heartbeat_index: FpVar<F>,
}

impl<F: PrimeField> AllocVar<PulseFoldInputs<F>, F> for PulseFoldInputsVar<F> {
    fn new_variable<T: Borrow<PulseFoldInputs<F>>>(
        cs: impl Into<Namespace<F>>,
        f: impl FnOnce() -> Result<T, SynthesisError>,
        mode: ark_r1cs_std::alloc::AllocationMode,
    ) -> Result<Self, SynthesisError> {
        let ns = cs.into();
        let cs = ns.cs();
        let binding = f()?;
        let val = binding.borrow();
        let leaf_hash = FpVar::<F>::new_variable(
            ark_relations::ns!(cs, "leaf_hash"),
            || Ok(val.leaf_hash),
            mode,
        )?;
        let heartbeat_index = FpVar::<F>::new_variable(
            ark_relations::ns!(cs, "heartbeat_index"),
            || Ok(val.heartbeat_index),
            mode,
        )?;
        Ok(Self { leaf_hash, heartbeat_index })
    }
}

// ─── Step Circuit ────────────────────────────────────────────────────────

/// Pulse Tree fold circuit.
///
/// Implements Sonobe's FCircuit trait for use with Nova IVC + Groth16 decider.
/// State is a single field element that accumulates each leaf fold.
#[derive(Clone, Copy, Debug)]
pub struct PulseFoldCircuit<F: PrimeField> {
    _f: PhantomData<F>,
}

impl<F: PrimeField> FCircuit<F> for PulseFoldCircuit<F> {
    type Params = ();
    type ExternalInputs = PulseFoldInputs<F>;
    type ExternalInputsVar = PulseFoldInputsVar<F>;

    fn new(_params: Self::Params) -> Result<Self, Error> {
        Ok(Self { _f: PhantomData })
    }

    fn state_len(&self) -> usize {
        1 // single field element state
    }

    fn generate_step_constraints(
        &self,
        _cs: ConstraintSystemRef<F>,
        _i: usize,
        z_i: Vec<FpVar<F>>,
        external_inputs: Self::ExternalInputsVar,
    ) -> Result<Vec<FpVar<F>>, SynthesisError> {
        let prev = &z_i[0];
        let leaf = &external_inputs.leaf_hash;
        let idx = &external_inputs.heartbeat_index;

        // t = prev * leaf + idx + 1
        let one = FpVar::<F>::one();
        let t = prev * leaf + idx + &one;

        // new_state = t^5 (Rescue-style power map)
        // t^2 (1 constraint)
        let t2 = &t * &t;
        // t^4 (1 constraint)
        let t4 = &t2 * &t2;
        // t^5 = t^4 * t (1 constraint)
        let new_state = &t4 * &t;

        Ok(vec![new_state])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_bn254::Fr;
    use folding_schemes::frontend::FCircuit;

    #[test]
    fn circuit_creates_successfully() {
        let circuit = PulseFoldCircuit::<Fr>::new(()).unwrap();
        assert_eq!(circuit.state_len(), 1);
    }
}
