import { Hono } from 'hono';
import { apiRegistry } from '../config/api-registry';

const router = new Hono();

// ─── GET /v1/compare/costs — Public cost comparison (no auth) ───────────────

router.get('/costs', async (c) => {
  return c.json({
    comparison: {
      simpleQuery: {
        clawnet: { credits: 3, usd: 0.003, breakdown: '2cr orchestration + 1cr endpoint' },
        openclaw: { estimatedUsd: 0.014, breakdown: '136K system prompt tokens + query tokens' },
        savings: '78% cheaper on ClawNet',
      },
      cachedQuery: {
        clawnet: { credits: 0.3, usd: 0.0003, breakdown: 'cache hit at 10% of live cost' },
        openclaw: { estimatedUsd: 0.014, breakdown: 'no caching — full cost every time' },
        savings: '98% cheaper on ClawNet',
      },
      heavyQuery: {
        clawnet: { credits: 15, usd: 0.015, breakdown: '5 endpoints + orchestration' },
        openclaw: { estimatedUsd: 0.075, breakdown: 'multiple tool calls + context accumulation' },
        savings: '80% cheaper on ClawNet',
      },
      monthlyEstimate: {
        casualUser: { clawnet: '$1-5/mo', openclaw: '$5-30/mo' },
        activeUser: { clawnet: '$5-15/mo', openclaw: '$25-100/mo' },
        heavyAutomation: { clawnet: '$15-30/mo', openclaw: '$100-600/mo' },
      },
    },
    clawnetAdvantages: [
      'Smart cache saves 90% on repeat queries',
      'Pre-flight budget check prevents overspending',
      'Hard budget locks — set a monthly limit, never exceed it',
      'No 136K token system prompt overhead',
      'Cost breakdown in every response',
      `${apiRegistry.length} pre-integrated endpoints — no setup needed`,
    ],
  });
});

export { router as costComparisonRouter };
