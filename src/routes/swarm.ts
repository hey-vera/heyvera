/**
 * Swarm Task Decomposition — POST /v1/swarm/task
 * Breaks a complex task into sub-tasks, routes each to the best available skill,
 * invokes them in parallel, then aggregates results via LLM synthesis.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { createSwarmTask, updateSwarmTask, getSwarmTask, listPublicSkills } from '../db/index';
import { llmComplete } from '../providers/llm';
import { logger } from '../utils/logger';
import { env } from '../config/index';

export const swarmRouter = new Hono();

const SwarmBody = z.object({
  task: z.string().min(1).max(1000),
  skills: z.array(z.string()).optional(),
  maxSubTasks: z.number().int().min(1).max(5).default(4),
});

swarmRouter.post('/task', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  let body: z.infer<typeof SwarmBody>;
  try { body = SwarmBody.parse(await c.req.json()); } catch (err) {
    return c.json({ error: 'Invalid body', details: (err as Error).message }, 400);
  }

  const swarmId = createSwarmTask(keyInfo.key, body.task);

  runSwarm(swarmId, keyInfo.key, body).catch(err => {
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
    subTasks: task.sub_tasks_json ? JSON.parse(task.sub_tasks_json) : null,
    results: task.results_json ? JSON.parse(task.results_json) : null,
    error: task.error,
    createdAt: task.created_at,
    completedAt: task.completed_at,
  });
});

// ─── Core swarm execution ─────────────────────────────────────────────────────

async function runSwarm(swarmId: string, agentKey: string, body: z.infer<typeof SwarmBody>) {
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

  // Step 2: Execute in parallel
  const results = await Promise.all(subTasks.map(async (st, i) => {
    try {
      if (st.skillId) {
        const r = await fetch(`http://localhost:${env.PORT}/v1/skills/${st.skillId}/invoke`, {
          method: 'POST',
          headers: { 'X-API-Key': agentKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: st.variables }),
        });
        const d = await r.json() as Record<string, unknown>;
        return { index: i, subtask: st.subtask, skillId: st.skillId, result: d.result ?? d, ok: r.ok };
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

  updateSwarmTask(swarmId, {
    status: 'COMPLETED',
    subTasks,
    results: [...results, { synthesis }],
  });

  logger.info({ swarmId, subTaskCount: subTasks.length }, 'Swarm task completed');
}
