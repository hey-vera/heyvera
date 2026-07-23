/**
 * Soft-launch integrity — honest copy for Pulse scheduled posts.
 *
 * Scheduling stores a row via POST /v1/pulse/schedules. Due drafts are NOT
 * auto-published by the SPA or in-process timer. Production needs cron
 * (scripts/pulse-schedule-process.sh) calling POST /v1/pulse/schedules/process.
 * Do not invent a "processor running" status without env evidence.
 */

/** Short note for Schedule tab subtitle / draft schedule footer. */
export const PULSE_SCHEDULE_PROCESSOR_NOTE =
  'Scheduled posts need server cron (scripts/pulse-schedule-process.sh → POST /v1/pulse/schedules/process). They do not auto-publish in the browser.';

/** Compact footer under upcoming schedules list. */
export const PULSE_SCHEDULE_PROCESS_ENDPOINT_HINT =
  'Due posts publish only when POST /v1/pulse/schedules/process runs (see PRODUCTION-ENV.md).';

/** Empty-state detail for Schedule tab. */
export const PULSE_SCHEDULE_EMPTY_DETAIL =
  'Approve a draft in Drafts, pick a publish time, then it will show here. Publishing still requires the server schedule processor (cron) — not a magic auto-publish.';

/**
 * Whether UI may claim the schedule processor is actively running.
 * Soft-launch: always false unless a future env probe is wired.
 */
export function isPulseScheduleProcessorClaimedRunning(
  env: Record<string, string | undefined> | null | undefined = null,
): boolean {
  // No VITE_* flag ships a live processor probe — never invent "running".
  void env;
  return false;
}

/** Optional status chrome when we deliberately do not claim processor health. */
export function pulseScheduleProcessorStatusLabel(
  env?: Record<string, string | undefined> | null,
): string {
  if (isPulseScheduleProcessorClaimedRunning(env)) {
    return 'Schedule processor: running';
  }
  return 'Schedule processor: configure server cron (not auto-detected)';
}
