/**
 * Swarm Task Decomposition — POST /v1/swarm/task
 * Breaks a complex task into sub-tasks, routes each to the best available skill,
 * invokes them in parallel, then aggregates results via LLM synthesis.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { createSwarmTask, updateSwarmTask, getSwarmTask, listPublicSkills, deductCredit, safeJsonParse } from '../db/index';
import { llmComplete } from '../providers/llm';
import { logger } from '../utils/logger';
import { env, SWARM_BASE_FEE } from '../config/index';

export const swarmRouter = new Hono();

const SwarmBody = z.object({
  task: z.string().min(1).max(1000),
  skills: z.array(z.string()).optional(),
  maxSubTasks: z.number().int().min(1).max(5).default(4),
  maxBudget: z.number().int().min(20).max(5000).default(200), // total credit cap including sub-tasks
});

// Recursion guard — swarm tasks set this header; inner invoke calls that see it are blocked
const SWARM_DEPTH_HEADER = 'X-Swarm-Depth';

swarmRouter.post('/task', checkApiKey, async (c) => {
  // Recursion guard — prevent nested swarms spawned from within a swarm
  if (c.req.header(SWARM_DEPTH_HEADER)) {
    return c.json({ error: 'Nested swarms are not permitted', code: 'SWARM_RECURSION_BLOCKED' }, 400);
  }

  const keyInfo = c.get('apiKeyInfo');
  const parsed = SwarmBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.flatten().fieldErrors }, 400);
  }
  const body = parsed.data;

  // Pre-flight: require enough credits to cover maxBudget PLUS the base fee.
  // SWARM_BASE_FEE is deducted immediately on top of sub-task costs, so the true
  // worst-case spend is maxBudget + SWARM_BASE_FEE.
  if (!keyInfo.isEnvKey) {
    const required = body.maxBudget + SWARM_BASE_FEE;
    if (keyInfo.credits < required) {
      return c.json({
        error: `Insufficient credits for swarm task (requires ${required}: ${body.maxBudget} maxBudget + ${SWARM_BASE_FEE} base fee)`,
        code: 'INSUFFICIENT_CREDITS',
        creditsAvailable: keyInfo.credits,
        creditsRequired: required,
        hint: `Lower maxBudget to ${Math.max(0, keyInfo.credits - SWARM_BASE_FEE)} or top up at claw-net.org`,
      }, 402);
    }
    const deducted = deductCredit(keyInfo.key, SWARM_BASE_FEE);
    if (!deducted) {
      return c.json({ error: 'Credit deduction failed', code: 'INSUFFICIENT_CREDITS' }, 402);
    }
  }

  const swarmId = createSwarmTask(keyInfo.key, body.task);

  runSwarm(swarmId, keyInfo.key, body, keyInfo.isEnvKey).catch(err => {
    logger.error({ err, swarmId }, 'Swarm task failed');
    updateSwarmTask(swarmId, { status: 'FAILED', error: String(err) });
  });

  return c.json({
    swarmId,
    status: 'PENDING',
    message: 'Swarm task started. Poll GET /v1/swarm/:id for results.',
    pollUrl: `/v1/swarm/${swarmId}`,
  }, 202);
});

swarmRouter.get('/:id', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();
  const task = getSwarmTask(id);

  if (!task) return c.json({ error: 'Swarm task not found' }, 404);
  if (task.agent_key !== keyInfo.key) return c.json({ error: 'Not found' }, 404);

  return c.json({
    id: task.id,
    task: task.task,
    status: task.status,
    subTasks: safeJsonParse(task.sub_tasks_json, null),
    results: safeJsonParse(task.results_json, null),
    error: task.error,
    createdAt: task.created_at,
    completedAt: task.completed_at,
  });
});

// ─── Core swarm execution ─────────────────────────────────────────────────────

export interface SwarmParams {
  task: string;
  skills?: string[];
  maxSubTasks: number;
  maxBudget?: number;
}

export async function runSwarm(swarmId: string, agentKey: string, body: SwarmParams, isEnvKey = false): Promise<void> {
  updateSwarmTask(swarmId, { status: 'RUNNING' });

  const skills = listPublicSkills().slice(0, 20);
  const skillList = skills.map(s => `${s.id}: ${s.name} — ${s.description}`).join('\n');

  // Step 1: LLM decomposition
  let subTasks: Array<{ subtask: string; skillId: string | null; variables: Record<string, string> }> = [];

  try {
    const resp = await llmComplete([
      { role: 'system', content: 'You are a task decomposition engine. Always return valid JSON only.' },
      { role: 'user', content: `Break this task into ${body.maxSubTasks} or fewer independent sub-tasks executable in parallel.\n\nAvailable skills:\n${skillList || 'none'}\n\nTask: ${body.task}\n\nReturn JSON array: [{ "subtask": "...", "skillId": "skill-id or null", "variables": {} }]` },
    ]);
    const match = resp.content.match(/\[[\s\S]*\]/);
    if (match) subTasks = JSON.parse(match[0]);
  } catch (err) {
    logger.warn({ err, swarmId }, 'LLM decomposition failed — single task fallback');
    subTasks = [{ subtask: body.task, skillId: body.skills?.[0] ?? null, variables: {} }];
  }

  updateSwarmTask(swarmId, { status: 'RUNNING', subTasks });

  // Validate and sanitize LLM-generated skillIds to prevent path traversal / SSRF
  const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
  subTasks = subTasks.filter(st => {
    if (st.skillId && !SAFE_ID.test(st.skillId)) {
      logger.warn({ skillId: st.skillId, swarmId }, 'Rejected invalid skillId from LLM decomposition');
      return false;
    }
    return true;
  });

  // Budget tracking — base fee already deducted; remaining budget for sub-tasks
  const maxBudget = body.maxBudget ?? 200;

  // Pre-allocate budget per subtask to avoid race conditions in parallel execution.
  // Each task gets an equal share; remaining (from tasks that skip or underspend) is reported.
  const skillSubtasks = subTasks.filter(st => st.skillId);
  const budgetPerSubtask = skillSubtasks.length > 0
    ? (maxBudget - SWARM_BASE_FEE) / skillSubtasks.length
    : 0;

  // Step 2: Execute in parallel
  const results = await Promise.all(subTasks.map(async (st, i) => {
    try {
      if (st.skillId) {
        if (budgetPerSubtask <= 0) {
          return { index: i, subtask: st.subtask, skillId: st.skillId, result: null, ok: false, error: 'Budget cap reached' };
        }
        const r = await fetch(`http://localhost:${env.PORT}/v1/skills/${encodeURIComponent(st.skillId)}/invoke`, {
          method: 'POST',
          headers: {
            'X-API-Key': agentKey,
            'Content-Type': 'application/json',
            [SWARM_DEPTH_HEADER]: '1', // block recursive swarms spawned by skills
          },
          body: JSON.stringify({ variables: st.variables }),
        });
        if (!r.ok) {
          return { index: i, subtask: st.subtask, skillId: st.skillId, result: null, ok: false, error: `HTTP ${r.status}` };
        }
        const d = await r.json() as Record<string, unknown>;
        return { index: i, subtask: st.subtask, skillId: st.skillId, result: d.result ?? d, ok: true, creditsUsed: (d.creditsUsed as number) ?? 0 };
      } else {
        const resp = await llmComplete([{ role: 'user', content: st.subtask }]);
        return { index: i, subtask: st.subtask, skillId: null, result: resp.content, ok: true };
      }
    } catch (err) {
      return { index: i, subtask: st.subtask, skillId: st.skillId ?? null, result: null, ok: false, error: String(err) };
    }
  }));

  // Step 3: Synthesize
  let synthesis = '';
  try {
    const resp = await llmComplete([
      { role: 'system', content: 'You are a synthesis engine. Combine parallel results into one coherent answer.' },
      { role: 'user', content: `Task: ${body.task}\n\nSub-task results:\n${results.map((r, i) => `[${i + 1}] ${r.subtask}\n${JSON.stringify(r.result)}`).join('\n\n')}\n\nSynthesize into a single structured answer.` },
    ]);
    synthesis = resp.content;
  } catch {
    synthesis = results.map((r, i) => `[${i + 1}] ${r.subtask}: ${JSON.stringify(r.result)}`).join('\n\n');
  }

  // Credits were deducted upfront in the route handler — no deduction needed here.

  updateSwarmTask(swarmId, {
    status: 'COMPLETED',
    subTasks,
    results: [...results, { synthesis }],
  });

  logger.info({ swarmId, subTaskCount: subTasks.length }, 'Swarm task completed');
}
