#!/usr/bin/env node
/**
 * confirmation-policy.mjs — Centralized confirmation policy for Ship Captain.
 *
 * Single source of truth for "should we prompt the user?"
 * Controls automation level based on risk level and user flags.
 *
 * Exports: getConfirmationPolicy, resolveMode, aggregateRisk, formatConfirmation
 */

// Risk level ordering for comparison
const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

// Steps that are mutations (vs. validation steps)
const MUTATION_STEPS = new Set(['edit', 'pr', 'push']);
// Steps that are validation (auto-run in careful mode too)
const VALIDATION_STEPS = new Set(['test', 'gate']);

/**
 * getConfirmationPolicy({ risk, mode, step })
 *
 * @param {object} options
 * @param {'low'|'medium'|'high'|'critical'} options.risk
 * @param {'default'|'yolo'|'careful'|'plan-only'} options.mode
 * @param {'plan'|'edit'|'test'|'gate'|'pr'|'push'} options.step
 * @returns {{ shouldConfirm: boolean, shouldBlock: boolean, reason: string }}
 */
export function getConfirmationPolicy({ risk, mode, step }) {
  const safeMode = mode || 'default';
  const safeRisk = risk || 'low';
  const safeStep = step || 'plan';

  // PLAN-ONLY mode: block all mutations, allow plan display
  if (safeMode === 'plan-only') {
    if (safeStep === 'plan') {
      return { shouldConfirm: false, shouldBlock: false, reason: 'Plan-only mode — showing plan' };
    }
    return {
      shouldConfirm: false,
      shouldBlock: true,
      reason: 'Plan-only mode — no mutations',
    };
  }

  // YOLO mode: no confirmations for any step at any risk level
  if (safeMode === 'yolo') {
    if (safeRisk === 'critical') {
      return {
        shouldConfirm: false,
        shouldBlock: false,
        reason: '⚠ YOLO mode on critical risk surface',
      };
    }
    return { shouldConfirm: false, shouldBlock: false, reason: 'YOLO mode — proceeding automatically' };
  }

  // CAREFUL mode: confirm every mutation/plan step; validation steps auto-run
  if (safeMode === 'careful') {
    if (VALIDATION_STEPS.has(safeStep)) {
      return { shouldConfirm: false, shouldBlock: false, reason: 'Validation step — auto-run' };
    }
    return {
      shouldConfirm: true,
      shouldBlock: false,
      reason: `Careful mode — confirming ${safeStep} step`,
    };
  }

  // DEFAULT mode: risk-based policy
  if (safeMode === 'default') {
    if (safeRisk === 'critical') {
      return {
        shouldConfirm: false,
        shouldBlock: true,
        reason: 'Critical risk requires --yolo flag',
      };
    }
    if (safeRisk === 'high') {
      if (safeStep === 'edit' || safeStep === 'pr') {
        return {
          shouldConfirm: true,
          shouldBlock: false,
          reason: `High-risk step requires confirmation before ${safeStep}`,
        };
      }
      return { shouldConfirm: false, shouldBlock: false, reason: 'High risk — auto-proceeding for non-critical step' };
    }
    // low or medium: no confirmations
    return { shouldConfirm: false, shouldBlock: false, reason: 'Low/medium risk — proceeding automatically' };
  }

  // Fallback: treat unknown modes as default/no-confirm
  return { shouldConfirm: false, shouldBlock: false, reason: 'Unknown mode — proceeding automatically' };
}

/**
 * resolveMode(argv) — Parse CLI flags into a mode string.
 *
 * @param {string[]} argv  Process argv array (e.g. process.argv)
 * @returns {'default'|'yolo'|'careful'|'plan-only'}
 */
export function resolveMode(argv) {
  const args = argv || [];
  if (args.includes('--yolo')) return 'yolo';
  if (args.includes('--careful')) return 'careful';
  if (args.includes('--plan-only') || args.includes('--dry-run')) return 'plan-only';
  return 'default';
}

/**
 * aggregateRisk(risks) — Return the highest risk level from an array.
 *
 * @param {string[]} risks  Array of risk strings
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function aggregateRisk(risks) {
  if (!Array.isArray(risks) || risks.length === 0) return 'low';
  let maxIndex = 0;
  for (const r of risks) {
    const idx = RISK_ORDER.indexOf(r);
    if (idx > maxIndex) maxIndex = idx;
  }
  return RISK_ORDER[maxIndex];
}

/**
 * formatConfirmation(step, risk, reason) — Format a human-readable confirmation prompt.
 *
 * @param {string} step
 * @param {string} risk
 * @param {string} reason
 * @returns {string}
 */
export function formatConfirmation(step, risk, reason) {
  if (risk === 'critical') {
    return `\u{1F534} Critical risk detected: ${reason}. This requires explicit approval. Continue? [Y/n]`;
  }
  if (risk === 'high') {
    return `⚠ High-risk step: ${reason}. Continue? [Y/n]`;
  }
  return `\u{2139} ${reason} (step: ${step}). Continue? [Y/n]`;
}
