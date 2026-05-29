//! Shared infrastructure for HeyVera products.
//!
//! This crate contains code used by both cortex-server and heyvera-server:
//! database, authentication, billing, cryptography, metrics, rate limiting.
//!
//! Migration plan: modules will move here from crates/api/ incrementally.
//! For now, both servers import directly from cortex-api. As modules migrate
//! here, the servers will switch their imports.

// Future home of:
// pub mod db;
// pub mod clerk;
// pub mod crypto;
// pub mod billing;
// pub mod stripe_client;
// pub mod metrics;
// pub mod ratelimit;
// pub mod validate;
