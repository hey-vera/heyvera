//! Soma Nova Prover — stdin/stdout JSON IPC
//!
//! Persistent subprocess that receives fold/compress/verify commands from Node.js.
//! Phase 1: SHA-256-based mock proving (functional IPC, real hash math).
//! Phase 2: Drop in Nova/Groth16 when nova-snark compiles on target.

mod circuit;

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

// ─── IPC Messages ────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(tag = "cmd")]
enum Command {
    #[serde(rename = "fold")]
    Fold {
        prev_root: String,
        leaf_hash: String,
        heartbeat_index: u64,
    },
    #[serde(rename = "compress")]
    Compress,
    #[serde(rename = "verify")]
    Verify {
        proof: String,
        root: String,
        heartbeat_index: u64,
    },
    #[serde(rename = "state")]
    State,
    #[serde(rename = "reset")]
    Reset,
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Serialize)]
struct FoldResponse {
    ok: bool,
    new_state_hash: String,
    heartbeat_index: u64,
    fold_count: u64,
}

#[derive(Serialize)]
struct CompressResponse {
    ok: bool,
    proof: String,
    proof_size_bytes: usize,
    root: String,
    heartbeat_index: u64,
    fold_count: u64,
}

#[derive(Serialize)]
struct VerifyResponse {
    ok: bool,
    valid: bool,
}

#[derive(Serialize)]
struct StateResponse {
    ok: bool,
    state_hash: String,
    heartbeat_index: u64,
    fold_count: u64,
    mode: String,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
    version: String,
    mode: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    ok: bool,
    error: String,
}

// ─── Prover State ────────────────────────────────────────────────────────

struct ProverState {
    state_hash: String,
    heartbeat_index: u64,
    fold_count: u64,
}

impl ProverState {
    fn new() -> Self {
        ProverState {
            state_hash: circuit::initial_state(),
            heartbeat_index: 0,
            fold_count: 0,
        }
    }

    fn fold(&mut self, prev_root: &str, leaf_hash: &str, heartbeat_index: u64) -> FoldResponse {
        self.state_hash = circuit::step_hash(prev_root, leaf_hash, heartbeat_index);
        self.heartbeat_index = heartbeat_index;
        self.fold_count += 1;

        FoldResponse {
            ok: true,
            new_state_hash: self.state_hash.clone(),
            heartbeat_index: self.heartbeat_index,
            fold_count: self.fold_count,
        }
    }

    fn compress(&self) -> CompressResponse {
        // Phase 1: SHA-256-based "proof" (hash of accumulated state).
        // Phase 2: replace with Groth16 compression of Nova instance.
        let proof = circuit::compress_proof(&self.state_hash, self.heartbeat_index, self.fold_count);

        CompressResponse {
            ok: true,
            proof: proof.clone(),
            proof_size_bytes: proof.len() / 2, // hex bytes
            root: self.state_hash.clone(),
            heartbeat_index: self.heartbeat_index,
            fold_count: self.fold_count,
        }
    }

    fn verify(&self, proof: &str, root: &str, heartbeat_index: u64) -> VerifyResponse {
        let expected = circuit::compress_proof(root, heartbeat_index, self.fold_count);
        VerifyResponse {
            ok: true,
            valid: proof == expected,
        }
    }

    fn reset(&mut self) {
        self.state_hash = circuit::initial_state();
        self.heartbeat_index = 0;
        self.fold_count = 0;
    }
}

// ─── Main Loop ───────────────────────────────────────────────────────────

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state = ProverState::new();

    // Signal ready
    let ready = serde_json::json!({"ready": true, "version": "0.1.0", "mode": "sha256-mock"});
    writeln!(stdout, "{}", ready).unwrap();
    stdout.flush().unwrap();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let response: String = match serde_json::from_str::<Command>(&line) {
            Ok(cmd) => match cmd {
                Command::Fold { prev_root, leaf_hash, heartbeat_index } => {
                    serde_json::to_string(&state.fold(&prev_root, &leaf_hash, heartbeat_index)).unwrap()
                }
                Command::Compress => {
                    serde_json::to_string(&state.compress()).unwrap()
                }
                Command::Verify { proof, root, heartbeat_index } => {
                    serde_json::to_string(&state.verify(&proof, &root, heartbeat_index)).unwrap()
                }
                Command::State => {
                    serde_json::to_string(&StateResponse {
                        ok: true,
                        state_hash: state.state_hash.clone(),
                        heartbeat_index: state.heartbeat_index,
                        fold_count: state.fold_count,
                        mode: "sha256-mock".to_string(),
                    }).unwrap()
                }
                Command::Reset => {
                    state.reset();
                    serde_json::to_string(&serde_json::json!({"ok": true})).unwrap()
                }
                Command::Ping => {
                    serde_json::to_string(&PingResponse {
                        ok: true,
                        version: "0.1.0".to_string(),
                        mode: "sha256-mock".to_string(),
                    }).unwrap()
                }
            },
            Err(e) => {
                serde_json::to_string(&ErrorResponse {
                    ok: false,
                    error: format!("Invalid command: {}", e),
                }).unwrap()
            }
        };

        writeln!(stdout, "{}", response).unwrap();
        stdout.flush().unwrap();
    }
}
