import { describe, expect, it } from 'vitest';
import {
  isPulseScheduleProcessorClaimedRunning,
  PULSE_SCHEDULE_EMPTY_DETAIL,
  PULSE_SCHEDULE_PROCESS_ENDPOINT_HINT,
  PULSE_SCHEDULE_PROCESSOR_NOTE,
  pulseScheduleProcessorStatusLabel,
} from './pulseScheduleHonesty';

describe('pulse schedule honesty copy', () => {
  it('mentions cron script and process endpoint — not magic auto-publish', () => {
    expect(PULSE_SCHEDULE_PROCESSOR_NOTE).toMatch(/pulse-schedule-process\.sh/);
    expect(PULSE_SCHEDULE_PROCESSOR_NOTE).toMatch(/schedules\/process/);
    expect(PULSE_SCHEDULE_PROCESSOR_NOTE.toLowerCase()).toMatch(/do not auto-publish/);
    expect(PULSE_SCHEDULE_PROCESS_ENDPOINT_HINT).toMatch(/schedules\/process/);
    expect(PULSE_SCHEDULE_EMPTY_DETAIL.toLowerCase()).toMatch(/cron|processor/);
  });

  it('never claims processor is running without a real probe', () => {
    expect(isPulseScheduleProcessorClaimedRunning(null)).toBe(false);
    expect(isPulseScheduleProcessorClaimedRunning({})).toBe(false);
    expect(isPulseScheduleProcessorClaimedRunning({ VITE_PULSE_PROCESSOR: '1' })).toBe(
      false,
    );
    expect(pulseScheduleProcessorStatusLabel()).toMatch(/cron|not auto-detected/i);
    expect(pulseScheduleProcessorStatusLabel()).not.toMatch(/^Schedule processor: running$/);
  });
});
