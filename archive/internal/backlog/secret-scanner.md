# @soma/secret-scanner

Status: **backlog / design** — first thing to build in the post-1.1 sequence. Smallest unit, highest signal.
Opened: 2026-04-10
Related: `wallet-rotation-architecture.md`, `gameplan-post-1-1.md`

## Motivation

During the Soma 1.1 shipping session, an unrelated diff in `SOMA-DELEGATION-SPEC.md` contained a paste dump that included a real ClawNet API key (`cn-59bf...`, full value intentionally redacted) and partial fragments of an EVM private key and EAS schema UID. The leak was caught manually by refusing to stage the file, but only because I happened to be reading the diff carefully. **This is not a repeatable defense.**

Soma is open source. The cost of a single committed secret is permanent — `git filter-branch` does not remove a secret from the hundreds of clones that have already pulled it. The only real defense is **never commit in the first place**, and the only reliable way to enforce that is a pre-commit hook that refuses to let a key-shaped string through.

## Package scope

`@soma/secret-scanner` — a tiny zero-dep-ish TypeScript package that:

1. Provides a pre-commit hook installable with one command (`npx @soma/secret-scanner install`).
2. Provides a CLI that scans staged diff content (`soma-scan --staged`) or arbitrary paths (`soma-scan path/`).
3. Provides a GitHub Action for PRs and pushes.
4. Ships a curated pattern list tuned for false-negative safety over false-positive annoyance.
5. Can be extended by a per-repo `.soma-scan.json` config for project-specific secrets.

## Scan patterns (initial set)

| Pattern                       | Regex (approx)                                    | Why |
|-------------------------------|---------------------------------------------------|-----|
| ClawNet API key               | `cn-[a-f0-9]{48}`                                 | Caught this session |
| EVM private key               | `(?:0x)?[a-fA-F0-9]{64}` (context-aware)          | Standard |
| Ed25519 secret (base64)       | 88-char base64 blobs near "secret"/"private"      | Soma-relevant |
| Solana private key            | 88-char base58 blobs                              | x402 ecosystem |
| OpenAI / Anthropic keys       | `sk-[A-Za-z0-9]{32,}`, `sk-ant-[A-Za-z0-9-]+`     | Common |
| AWS access / secret           | `AKIA[0-9A-Z]{16}`, 40-char secrets                | Standard |
| GitHub PATs                   | `ghp_[A-Za-z0-9]{36}`, `github_pat_...`           | Standard |
| Clerk secret                  | `sk_live_[A-Za-z0-9]{24,}`                        | ClawNet stack |
| Stripe secret                 | `sk_live_[A-Za-z0-9]{24,}`                        | ClawNet stack |
| Generic high-entropy blob     | Shannon entropy > 4.5, length > 32, not base case | Catch-all |
| `.env` file content signature | Lines matching `KEY=val` with high-entropy val    | Paste-dump detection |

The last row is specifically what would have caught this session's leak: the paste was a terminal dump of `.env` contents, and scanning any staged file (not just `.env`) for that shape would have tripped.

## Hook integration

```bash
# In soma-heart repo or any consumer repo
npx @soma/secret-scanner install
# Writes .husky/pre-commit or .git/hooks/pre-commit that runs:
#   soma-scan --staged
# Exit code non-zero = commit blocked
```

The hook must be **fail-closed**: if the scanner binary is missing, the hook refuses the commit with a loud message ("scanner missing, refusing to commit until installed"). No silent skips, no `--no-verify` friendliness — operators who need to bypass must document why.

## False positive handling

Per-repo allowlist file: `.soma-scan-allowlist.json`. Entries are `{ hash: string, reason: string, addedBy: string, addedAt: string }`. A matched string is compared against the allowlist by hash; known-safe fixtures (test vectors, example keys in docs) are listed explicitly. Adding an entry requires a hash, not a plaintext, so the allowlist itself never stores a secret.

## CI integration

GitHub Action that runs on every PR and push. On hit, it:

1. Fails the check.
2. Redacts the secret in logs (prints the first 6 chars only).
3. Posts a comment pointing to the file and line with instructions.
4. **Does not print the secret in logs**, ever. Log redaction is enforced by the action itself.

## What this does NOT do

- Does not scan existing git history. Rotating existing leaked keys is a separate manual step.
- Does not claim to catch every possible secret — the generic high-entropy rule misses obfuscated secrets.
- Does not replace wallet rotation. Even with perfect scanning, keys leak through other channels (memory scrapes, compromised deps). Scanning is the outermost layer; rotation is the inner defense.

## Build scope

- Single package, single file of patterns, ~500 LOC total.
- Vitest tests with a fixture corpus of real-shape secrets and known-safe strings.
- Published to npm as `@soma/secret-scanner`.
- README with install, CI setup, allowlist docs.

## Why first

Tiny. High signal. Directly addresses a leak that already happened in this codebase. Every subsequent build session benefits immediately. Ships in hours, not days. Blocks nothing else — can be built in parallel with wallet rotation and 1.2 primitives.

## Follow-ups after shipping

- Install the hook in every Soma/ClawNet/HeyDATA repo.
- Run a one-time history scan (separate tool) to confirm no existing committed secrets.
- Rotate any keys found in history.
- Document in each repo's CONTRIBUTING that the hook is mandatory.
