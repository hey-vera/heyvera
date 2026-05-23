# Rust Compilation Setup Guide

## Current Status

- ✅ **Workspace Configuration**: Proper Cargo workspace with 7 crates
- ✅ **Dependencies**: All required dependencies declared in workspace Cargo.toml
- ❌ **Compilation**: System-level TLS memory allocation issue preventing rustc from running
- ❌ **Testing**: Cannot run tests until compilation works

## System Issue

```bash
# Error encountered:
error while loading shared libraries: librustc_driver-6108105cd7e839cf.so: 
cannot allocate memory in static TLS block
```

This is a known issue with certain Linux configurations and Rust installations.

## Dependencies Analysis

**Core dependencies are properly declared:**
- `ed25519-dalek` - For cryptographic capability signing ✅
- `sqlx` + `pgvector` - For vector database operations ✅  
- `text-embeddings-inference` - For real embedding generation ✅
- `axum` + `tower-http` - For API server ✅
- `tokio` - For async runtime ✅

## Required Fix Steps

1. **Resolve TLS allocation issue**:
   ```bash
   # Try alternative Rust installation method
   curl --proto '=https' --tlsv1.2 -sSf https://forge.rust-lang.org/infra/channel-layout.html
   
   # Or use system package manager
   sudo apt update && sudo apt install rustc cargo
   
   # Or rebuild toolchain
   rustup self uninstall && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Verify compilation**:
   ```bash
   cd crates
   cargo check --workspace
   cargo test --workspace
   ```

3. **Add missing dependencies** (if needed during implementation):
   ```toml
   # Add to workspace dependencies if missing:
   chacha20poly1305 = "0.10"  # For content encryption
   hkdf = "0.12"              # For key derivation
   blake3 = "1.5"             # For provenance hashing
   ```

## Implementation Notes

**Code structure is ready for:**
- Real embeddings implementation (replaces hash-based stubs)
- Authority signal persistence (replaces Ok(()) placeholders)  
- Conflict preservation (replaces resolution with preservation)
- Capability signing (replaces todo!() macros)

**Next steps once compilation works:**
1. Run `cargo check` to identify specific compilation errors
2. Fix import paths and missing implementations
3. Add proper error handling
4. Create integration tests

## Temporary Workaround

Since compilation is blocked by system issues, we can:
1. Review and fix code logic without compilation
2. Prepare implementation files
3. Set up proper testing framework
4. Document expected behavior

Once system issues are resolved, the code changes can be verified and tested.