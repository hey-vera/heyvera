import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/index', () => ({
  env: {},
}));

import { executePlan } from '../../src/core/executor';
import type { ParsedIntent } from '../../src/core/intent-parser';

function intent(
  steps: ParsedIntent['steps'],
  parallelGroups: ParsedIntent['parallelGroups'],
): ParsedIntent {
  return {
    summary: 'unit test plan',
    reasoning: 'exercise current executor behavior',
    steps,
    parallelGroups,
  };
}

describe('core/executor current minimal behavior', () => {
  it('executes known registry endpoints in simulation mode and sums live costs', async () => {
    const result = await executePlan(
      intent(
        [
          {
            endpointId: 'claw-token-price',
            params: { mintAddress: `unit-${crypto.randomUUID()}` },
            dependsOn: [],
            reason: 'price',
          },
          {
            endpointId: 'claw-token-risk',
            params: { mintAddress: `unit-${crypto.randomUUID()}` },
            dependsOn: [],
            reason: 'risk',
          },
        ],
        [['0', '1']],
      ),
    );

    expect(result.steps).toHaveLength(2);
    expect(result.steps.map((step) => step.success)).toEqual([true, true]);
    expect(result.steps.map((step) => step.cached)).toEqual([false, false]);
    expect(result.totalCost).toBe(0.004);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('serves repeated endpoint calls from cache with zero step cost', async () => {
    const params = { mintAddress: `cache-${crypto.randomUUID()}` };
    const plan = intent(
      [
        {
          endpointId: 'claw-token-price',
          params,
          dependsOn: [],
          reason: 'price',
        },
      ],
      [['0']],
    );

    const first = await executePlan(plan);
    const second = await executePlan(plan);

    expect(first.steps[0]).toEqual(
      expect.objectContaining({
        endpointId: 'claw-token-price',
        success: true,
        cached: false,
        cost: 0.001,
      }),
    );
    expect(second.steps[0]).toEqual(
      expect.objectContaining({
        endpointId: 'claw-token-price',
        success: true,
        cached: true,
        cost: 0,
      }),
    );
    expect(second.totalCost).toBe(0);
  });

  it('returns ENDPOINT_NOT_FOUND for unknown endpoints without throwing', async () => {
    const result = await executePlan(
      intent(
        [
          {
            endpointId: 'missing-endpoint',
            params: {},
            dependsOn: [],
            reason: 'negative path',
          },
        ],
        [['0']],
      ),
    );

    expect(result.steps).toEqual([
      expect.objectContaining({
        endpointId: 'missing-endpoint',
        success: false,
        cached: false,
        cost: 0,
        error: 'ENDPOINT_NOT_FOUND',
      }),
    ]);
    expect(result.totalCost).toBe(0);
  });
});
