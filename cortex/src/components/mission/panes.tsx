import { lazy, Suspense } from 'react';
import { PaneStub } from './MissionControl';

/**
 * The six panes of SURFACE.md, mounted onto what exists today.
 *
 * Where a pane has real machinery it mounts it. Where it does not, it says so
 * and names the gating task rather than rendering a plausible-looking screen.
 */

const LedgerView = lazy(() => import('../ledger/LedgerView'));
const AdminView = lazy(() => import('../admin/AdminView'));

function Loading() {
  return <div className="p-8 text-sm text-[var(--muted)]">Loading…</div>;
}

/// Runs is real now — see RunsPane.tsx. Re-exported here so the route table in
/// App.tsx keeps importing every pane from one place.
export { default as RunsPane } from './RunsPane';

export function ReceiptsPane() {
  return (
    <PaneStub title="Receipts" blockedOn="V3 — persisting verdicts (migration v61)">
      The trust page: every verification, with the commands that ran, their exit
      codes, and enough output to settle a dispute. The verifier now computes
      verdicts from checks Cortex executed itself (V1, V2, V5) and the renderer
      for them ships in <code>Receipt.tsx</code> — but nothing is stored yet, so
      there is nothing to list. Deliberately no sample receipt here: a screen
      that shows a plausible verification which never happened is exactly the
      thing this pane exists to make impossible.
    </PaneStub>
  );
}

export function LedgerPane() {
  return (
    <Suspense fallback={<Loading />}>
      <LedgerView />
    </Suspense>
  );
}

export { default as LeasesPane } from './LeasesPane';

export function AdminPane() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminView />
    </Suspense>
  );
}
