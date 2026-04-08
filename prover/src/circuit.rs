//! Circuit module — step function and compression
//!
//! Phase 1: SHA-256-based mock (same math, no ZK).
//! Phase 2: Replace with Nova step circuit using Poseidon (~240 R1CS constraints).
//!
//! The step function proves: "this Pulse Tree transition is valid."
//!   step_function(prev_state, new_leaf) -> next_state
//!   assert H(prev_root || leaf_hash || heartbeat_index) == new_root
//!   assert heartbeat_index == prev_heartbeat_index + 1

use sha2::{Sha256, Digest};

/// Hash helper — SHA-256, returns hex string.
fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

/// Initial state — genesis hash before any folds.
pub fn initial_state() -> String {
    sha256_hex("soma:nova:genesis")
}

/// Step function: fold a new leaf into the running state.
///
/// Phase 1 (current): H(prev_root || leaf_hash || heartbeat_index)
/// Phase 2 (Nova): Poseidon(prev_root || leaf_hash || heartbeat_index) inside R1CS circuit
pub fn step_hash(prev_root: &str, leaf_hash: &str, heartbeat_index: u64) -> String {
    sha256_hex(&format!("soma:fold:{}:{}:{}", prev_root, leaf_hash, heartbeat_index))
}

/// Compress the accumulated state into a "proof".
///
/// Phase 1 (current): SHA-256 hash of (state_hash, heartbeat_index, fold_count).
/// Phase 2 (Groth16): 192-byte BN254 proof via Sonobe DeciderEth.
///
/// The returned string is a hex-encoded hash. In Phase 2, this becomes
/// the actual Groth16 proof bytes (192 bytes = 384 hex chars).
pub fn compress_proof(state_hash: &str, heartbeat_index: u64, fold_count: u64) -> String {
    sha256_hex(&format!("soma:compress:{}:{}:{}", state_hash, heartbeat_index, fold_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_state_is_deterministic() {
        assert_eq!(initial_state(), initial_state());
    }

    #[test]
    fn step_hash_changes_with_different_inputs() {
        let s1 = step_hash("root1", "leaf1", 1);
        let s2 = step_hash("root1", "leaf2", 1);
        let s3 = step_hash("root1", "leaf1", 2);
        assert_ne!(s1, s2);
        assert_ne!(s1, s3);
    }

    #[test]
    fn compress_is_deterministic() {
        let p1 = compress_proof("state", 100, 50);
        let p2 = compress_proof("state", 100, 50);
        assert_eq!(p1, p2);
    }

    #[test]
    fn step_then_compress_round_trip() {
        let mut state = initial_state();
        for i in 1..=10 {
            state = step_hash(&state, &format!("leaf-{}", i), i);
        }
        let proof = compress_proof(&state, 10, 10);
        assert_eq!(proof.len(), 64); // SHA-256 hex
    }
}
