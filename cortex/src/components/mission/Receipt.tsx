import { AlertCircle, CheckCircle2, HelpCircle, MinusCircle } from 'lucide-react';

/**
 * The receipt: what Cortex ran, what happened, and why a charge is defensible.
 *
 * Shapes mirror `cortex_core::verification` exactly (V1/V5) so this renders
 * the real thing the moment V3 persists it — no translation layer to drift.
 *
 * The rule this component exists to honour: it renders only what a check
 * execution actually reported. No inferred status, no "probably passed", no
 * summary that outruns its evidence. A receipt that flatters the run is worse
 * than no receipt, because the whole product claim rests on this being
 * literally true.
 */

export type Verdict = 'verified' | 'failed' | 'inconclusive' | 'unverified';
export type CheckOutcome = 'passed' | 'failed' | 'timed_out' | 'not_executed';

export interface CheckExecution {
  spec_id: string;
  exit_code: number | null;
  outcome: CheckOutcome;
  duration_ms: number;
  output_digest: string;
  output_tail: string;
  runner_image: string;
}

export interface VerdictReport {
  verdict: Verdict;
  required_total: number;
  required_passed: number;
  failed: string[];
  not_executed: string[];
}

export interface Receipt {
  verification_id: string;
  run_id: string;
  step_id: string;
  attempt: number;
  tree_hash: string;
  gate: VerdictReport;
  executions: CheckExecution[];
}

const VERDICT_COPY: Record<Verdict, { label: string; detail: string; className: string }> = {
  verified: {
    label: 'Verified',
    detail: 'Every required check ran here and passed.',
    className: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10',
  },
  failed: {
    label: 'Failed',
    detail:
      'A required check ran and did not pass. No charge; a charge already taken is refunded.',
    className: 'text-red-300 border-red-500/25 bg-red-500/10',
  },
  inconclusive: {
    label: 'Inconclusive',
    // The distinction that keeps the refund promise honest in both directions.
    detail: 'A required check could not be run. That is ours, not yours — no charge and no refund.',
    className: 'text-amber-300 border-amber-500/25 bg-amber-500/10',
  },
  unverified: {
    label: 'Unverified',
    detail:
      'No checks were derivable for this work. Charged at the normal rate, without the verified badge and without the refund promise.',
    className: 'text-[var(--muted)] border-white/15 bg-white/5',
  },
};

function OutcomeIcon({ outcome }: { outcome: CheckOutcome }) {
  if (outcome === 'passed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (outcome === 'failed' || outcome === 'timed_out') {
    return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
  }
  if (outcome === 'not_executed') return <HelpCircle className="h-3.5 w-3.5 text-amber-400" />;
  return <MinusCircle className="h-3.5 w-3.5 text-[var(--muted)]" />;
}

function outcomeLabel(execution: CheckExecution): string {
  switch (execution.outcome) {
    case 'passed':
      return `passed (exit ${execution.exit_code ?? 0})`;
    case 'failed':
      return `failed (exit ${execution.exit_code ?? '?'})`;
    case 'timed_out':
      // Stated as a failure of the work, not of our infrastructure — a hung
      // test is the defect the customer is paying to be protected from.
      return 'timed out — counted as a failure';
    case 'not_executed':
      return 'could not be run';
  }
}

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const copy = VERDICT_COPY[receipt.gate.verdict];

  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02]">
      <div className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 ${copy.className}`}>
        <span className="text-sm font-semibold">{copy.label}</span>
        <span className="text-[11px] opacity-80">
          {receipt.gate.required_passed}/{receipt.gate.required_total} required checks passed
        </span>
      </div>

      <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">{copy.detail}</p>

      <ul className="border-t border-white/5">
        {receipt.executions.length === 0 ? (
          <li className="px-3 py-2 text-xs text-[var(--muted)]">No checks were executed.</li>
        ) : (
          receipt.executions.map((execution) => (
            <li
              key={execution.spec_id}
              className="border-b border-white/5 px-3 py-2 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <OutcomeIcon outcome={execution.outcome} />
                <span className="font-mono text-xs text-white">{execution.spec_id}</span>
                <span className="text-[11px] text-[var(--muted)]">
                  {outcomeLabel(execution)} · {(execution.duration_ms / 1000).toFixed(1)}s
                </span>
              </div>
              {execution.output_tail && (
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--muted-strong)]">
                  {execution.output_tail}
                </pre>
              )}
            </li>
          ))
        )}
      </ul>

      {/* Provenance. "It passed" is only reproducible if where it passed and
          what it passed against are both pinned. */}
      <div className="border-t border-white/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-[var(--muted)]">
        <p>tree {receipt.tree_hash.slice(0, 12)}</p>
        {receipt.executions[0] && <p>runner {receipt.executions[0].runner_image}</p>}
        <p>
          attempt {receipt.attempt} · verification {receipt.verification_id.slice(0, 12)}
        </p>
      </div>
    </div>
  );
}
