# Reference material (not shipped as product)

## synthr-pulse/ — REMOVED from the working tree

The vendored clone of https://github.com/hey-vera/Synthr-Files (`apps/pulse`)
was **deleted in `c9958616`** (443 tracked files). It was never in the build
graph: its `backend/Cargo.toml` was not a `[workspace]` member and the name
appeared nowhere in `Cargo.lock`.

Git history retains all of it. To read a file from it:

```bash
git show c9958616^:heyvera/reference/synthr-pulse/README.md
```

To restore the whole tree:

```bash
git checkout c9958616^ -- heyvera/reference/synthr-pulse/
```

**Nothing was lost, and nothing needs restoring to build.** What the tree was
*for* — the feature inventory, policies, and UX ideas for rebuilding Pulse into
heyvera.org — was already extracted into docs that remain in the repository:

- `../docs/PULSE-REFERENCE-INVENTORY.md` — the file-by-file inventory
- `../docs/PULSE-STRATEGY.md` — what to rebuild and what to ignore

Those two are the reason the source tree is no longer needed. Read them first;
reach for `git show` only when the inventory points at a detail it did not
capture.

Live Pulse remains `heyvera/src/pages/AIPage.tsx` + Rust `/v1/pulse/*`. It was
never this SPA, and this SPA was never a second app to deploy.
