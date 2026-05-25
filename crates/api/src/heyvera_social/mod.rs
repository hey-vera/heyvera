//! HeyVera social backend foundation.
//!
//! This module is intentionally not wired into the live Cortex router yet.
//! It preserves the first production contract shapes and seams for the
//! future Rust/Postgres social backend slice.

pub mod errors;
pub mod routes;
pub mod store;
pub mod types;
