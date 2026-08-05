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

export function RunsPane() {
  return (
    <PaneStub title="Runs" blockedOn="F2 — mission control on real APIs">
      A DAG view of every step in a run, live over SSE, each completed step
      showing the receipt that verified it. The machinery exists — RunPanel and
      the operations graph — but it is still wired to the chat shell rather
      than to the run API. F2 rewires it.
    </PaneStub>
  );
}

export function ReceiptsPane() {
  return (
    <PaneStub title="Receipts" blockedOn="V1–V5 — the verifier">
      The trust page: every verification, with the commands that ran, their
      exit codes, and enough output to settle a dispute. This pane is empty
      because the verifier does not execute anything yet — it summarizes
      evidence the worker reports about itself. Until that changes, a receipts
      screen here would be theatre.
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

export function LeasesPane() {
  return (
    <PaneStub title="Leases" blockedOn="C4 — semantic leases">
      Who holds which surface, why, and until when. Lease enforcement is real
      today, but a lease still claims the paths someone thought to list. C4
      makes it claim the computed dependency closure of the edit — and this
      pane becomes the enterprise demo.
    </PaneStub>
  );
}

export function AdminPane() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminView />
    </Suspense>
  );
}
