/**
 * LLM Proxy Gateway — POST /v1/llm/chat
 *
 * Routes requests to 38+ LLM models via x402engine, charged in ClawNet credits.
 * Users pay credits; we pay x402engine in USDC. No separate LLM API keys needed.
 *
 * Compatible with OpenAI chat completions format for easy drop-in replacement.
 *
 * Supported models (via x402engine):
 *   OpenAI:     gpt-4o, gpt-4o-mini, gpt-5.1, gpt-5.2, gpt-5.2-pro, gpt-5.4
 *   Anthropic:  claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5
 *   Google:     gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash, gemini-3.1-pro
 *   xAI:        grok-4, grok-code-fast
 *   DeepSeek:   deepseek-v3, deepseek-r1
 *   Meta:       llama-3.3-70b
 *   Qwen:       qwen3-235b, qwen3-coder
 *   Mistral:    mistral-large-3
 *   Perplexity: perplexity-sonar
 *   MiniMax:    minimax-m2.5
 */

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { checkApiKey } from '../middleware/auth';
import { trackDelegatedSpend } from '../utils/billing';
import { deductCredit, getDb } from '../db/index';
import { round6, cacheCreditCost } from '../core/credits';
import { cacheGet, cacheSet } from '../cache/index';
import { clawApiCall } from '../providers/clawapis';
import { logger } from '../utils/logger';

export const llmRouter = new Hono();

// ─── Model catalog ─────────────────────────────────────────────────────────────

export const LLM_MODELS = {
  // OpenAI
  'gpt-4o':           { path: '/api/llm/gpt-4o',           costPerCall: 0.04,  creditCost: 80,   description: 'GPT-4o — multimodal, fast, vision support' },
  'gpt-4o-mini':      { path: '/api/llm/gpt-4o-mini',      costPerCall: 0.003, creditCost: 6,    description: 'GPT-4o Mini — fast, cheap, great for simple tasks' },
  'gpt-5.1':          { path: '/api/llm/gpt-5-1',          costPerCall: 0.035, creditCost: 70,   description: 'GPT-5.1 — reasoning, code, complex tasks' },
  'gpt-5.2':          { path: '/api/llm/gpt-5-2',          costPerCall: 0.08,  creditCost: 160,  description: 'GPT-5.2 — advanced reasoning' },
  'gpt-5.2-pro':      { path: '/api/llm/gpt-5-2-pro',      costPerCall: 0.25,  creditCost: 500,  description: 'GPT-5.2 Pro — most capable OpenAI model' },
  'gpt-5.4':          { path: '/api/llm/gpt-5-4',          costPerCall: 0.10,  creditCost: 200,  description: 'GPT-5.4 — latest OpenAI flagship' },
  // Anthropic
  'claude-sonnet-4-6':{ path: '/api/llm/claude-sonnet-4-6', costPerCall: 0.06, creditCost: 120,  description: 'Claude Sonnet 4.6 — balanced, extended thinking, vision' },
  'claude-opus-4-6':  { path: '/api/llm/claude-opus-4-6',  costPerCall: 0.09,  creditCost: 180,  description: 'Claude Opus 4.6 — most capable Anthropic model' },
  'claude-haiku-4-5': { path: '/api/llm/claude-haiku-4-5', costPerCall: 0.02,  creditCost: 40,   description: 'Claude Haiku 4.5 — fast and cheap' },
  // Google
  'gemini-2.5-flash': { path: '/api/llm/gemini-2-5-flash', costPerCall: 0.009, creditCost: 18,   description: 'Gemini 2.5 Flash — 1M context, multimodal, very fast' },
  'gemini-2.5-pro':   { path: '/api/llm/gemini-2-5-pro',   costPerCall: 0.035, creditCost: 70,   description: 'Gemini 2.5 Pro — best Google model for complex reasoning' },
  'gemini-3-flash':   { path: '/api/llm/gemini-3-flash',   costPerCall: 0.012, creditCost: 24,   description: 'Gemini 3 Flash — fast and capable' },
  'gemini-3.1-pro':   { path: '/api/llm/gemini-3-1-pro',   costPerCall: 0.05,  creditCost: 100,  description: 'Gemini 3.1 Pro — latest Google Pro model' },
  // xAI
  'grok-4':           { path: '/api/llm/grok-4',           costPerCall: 0.06,  creditCost: 120,  description: 'Grok 4 — real-time web search built-in, xAI flagship' },
  'grok-code-fast':   { path: '/api/llm/grok-code-fast',   costPerCall: 0.04,  creditCost: 80,   description: 'Grok Code Fast — optimized for code generation' },
  // DeepSeek
  'deepseek-v3':      { path: '/api/llm/deepseek-v3',      costPerCall: 0.005, creditCost: 10,   description: 'DeepSeek V3 — best cost-per-token, strong coding' },
  'deepseek-r1':      { path: '/api/llm/deepseek-r1',      costPerCall: 0.01,  creditCost: 20,   description: 'DeepSeek R1 — chain-of-thought reasoning' },
  // Meta
  'llama-3.3-70b':    { path: '/api/llm/llama-3-3-70b',    costPerCall: 0.002, creditCost: 4,    description: 'Llama 3.3 70B — open source, fast, affordable' },
  // Qwen
  'qwen3-235b':       { path: '/api/llm/qwen3-235b',       costPerCall: 0.004, creditCost: 8,    description: 'Qwen3 235B — large scale, multilingual' },
  'qwen3-coder':      { path: '/api/llm/qwen3-coder',      costPerCall: 0.004, creditCost: 8,    description: 'Qwen3 Coder — specialized for code generation' },
  // Mistral
  'mistral-large-3':  { path: '/api/llm/mistral-large-3',  costPerCall: 0.006, creditCost: 12,   description: 'Mistral Large 3 — strong reasoning, European data' },
  // Perplexity
  'perplexity-sonar': { path: '/api/llm/perplexity-sonar', costPerCall: 0.06,  creditCost: 120,  description: 'Perplexity Sonar — web-grounded answers with citations' },
  // MiniMax
  'minimax-m2.5':     { path: '/api/llm/minimax-m2-5',     costPerCall: 0.01,  creditCost: 20,   description: 'MiniMax M2.5 — long context, multilingual' },
} as const;

export type LlmModelId = keyof typeof LLM_MODELS;

const X402ENGINE_BASE = 'https://x402-gateway-production.up.railway.app';
const MARKUP = 1.15; // 15% margin over x402engine cost

// ─── Request schema (OpenAI-compatible) ───────────────────────────────────────

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(50000),
});

const ChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1).max(100),
  max_tokens: z.number().int().min(1).max(8192).default(1024),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().default(false),
});

// ─── GET /v1/llm/models — list all available models ──────────────────────────

llmRouter.get('/models', (c) => {
  return c.json({
    models: Object.entries(LLM_MODELS).map(([id, meta]) => ({
      id,
      description: meta.description,
      creditCost: round6(meta.creditCost * MARKUP),
      costUsd: (meta.costPerCall * MARKUP).toFixed(4),
      provider: id.startsWith('claude') ? 'Anthropic'
        : id.startsWith('gemini') ? 'Google'
        : id.startsWith('grok') ? 'xAI'
        : id.startsWith('deepseek') ? 'DeepSeek'
        : id.startsWith('llama') ? 'Meta'
        : id.startsWith('qwen') ? 'Alibaba'
        : id.startsWith('mistral') ? 'Mistral'
        : id.startsWith('perplexity') ? 'Perplexity'
        : id.startsWith('minimax') ? 'MiniMax'
        : 'OpenAI',
    })),
    totalModels: Object.keys(LLM_MODELS).length,
    poweredBy: 'x402engine via ClawNet credits',
    hint: 'POST /v1/llm/chat with {"model": "...", "messages": [...]}',
  });
});

// ─── POST /v1/llm/chat — proxy to x402engine ──────────────────────────────────

llmRouter.post('/chat', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const parsed = ChatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, 400);
  }
  const { model, messages, max_tokens, temperature } = parsed.data;

  const modelMeta = LLM_MODELS[model as LlmModelId];
  if (!modelMeta) {
    return c.json({
      error: 'Unknown model. See availableModels for valid options.',
      availableModels: Object.keys(LLM_MODELS),
    }, 400);
  }

  const creditCost = round6(modelMeta.creditCost * MARKUP);

  // Pre-flight credit check
  if (!keyInfo.isEnvKey && keyInfo.credits < creditCost) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      creditsRequired: creditCost,
      creditsAvailable: keyInfo.credits,
      model,
      hint: 'Top up at claw-net.org',
    }, 402);
  }

  // Cache check — use SHA-256 hash to avoid key collisions from truncated base64
  const cacheKey = `llm:${model}:${crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 16)}`;
  const cached = await cacheGet<{ content: string; model: string; usage: unknown }>(cacheKey);
  if (cached) {
    // Proportional cache pricing — 10% of live cost, min 0.1 credits
    const cacheCredits = cacheCreditCost(creditCost);
    if (!keyInfo.isEnvKey) {
      if (keyInfo.credits < cacheCredits) {
        return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsAvailable: keyInfo.credits }, 402);
      }
      deductCredit(keyInfo.key, cacheCredits);
      trackDelegatedSpend(keyInfo, cacheCredits);
    }
    logger.info({ model, cached: true, creditsUsed: cacheCredits }, 'LLM cache hit');
    return c.json({ ...cached, cached: true, creditsCharged: cacheCredits });
  }

  logger.info({ model, messages: messages.length, credits: creditCost }, 'LLM proxy request');

  try {
    // Build OpenAI-compatible payload for x402engine
    const payload: Record<string, unknown> = {
      messages,
      max_tokens,
    };
    if (temperature !== undefined) payload.temperature = temperature;

    // x402engine uses prompt + systemPrompt format for some models — normalize
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsgs = messages.filter((m) => m.role !== 'system');
    const normalizedPayload = {
      prompt: userMsgs.map((m) => `${m.role}: ${m.content}`).join('\n'),
      systemPrompt: systemMsg?.content,
      maxTokens: max_tokens,
      ...(temperature !== undefined ? { temperature } : {}),
    };

    const result = await clawApiCall(
      modelMeta.path,
      normalizedPayload,
      X402ENGINE_BASE,
    ) as Record<string, unknown>;

    // Deduct credits atomically
    if (!keyInfo.isEnvKey) {
      const ok = getDb().transaction(() => deductCredit(keyInfo.key, creditCost))();
      if (!ok) {
        return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
      trackDelegatedSpend(keyInfo, creditCost);
    }

    // Normalize response to OpenAI format
    const choices = result.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const content = result.content ?? result.text ?? choices?.[0]?.message?.content ?? JSON.stringify(result);
    const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    const response = {
      id: `llm-${Date.now()}`,
      object: 'chat.completion',
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: String(content) },
        finish_reason: result.finishReason ?? result.finish_reason ?? 'stop',
      }],
      usage,
      creditsCharged: creditCost,
      poweredBy: 'x402engine via ClawNet',
    };

    // Cache for 5 min (non-creative queries benefit from caching)
    await cacheSet(cacheKey, response, 300);

    return c.json(response);
  } catch (err) {
    logger.error({ model, err }, 'LLM proxy error');
    return c.json({ error: 'LLM request failed', details: String(err), model }, 500);
  }
});

// ─── POST /v1/llm/embeddings — text embeddings via x402engine ─────────────────

const EmbeddingsSchema = z.object({
  input: z.union([z.string().max(50000), z.array(z.string().max(10000)).max(100)]),
  model: z.string().default('text-embedding-3-small'),
});

llmRouter.post('/embeddings', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const parsed = EmbeddingsSchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, 400);

  const { input, model } = parsed.data;
  const creditCost = 2; // 2 credits per embedding call (~$0.001)

  if (!keyInfo.isEnvKey && keyInfo.credits < creditCost) {
    return c.json({ error: 'Insufficient credits', creditsRequired: creditCost, creditsAvailable: keyInfo.credits }, 402);
  }

  try {
    const result = await clawApiCall('/api/embeddings', { input, model }, X402ENGINE_BASE) as Record<string, unknown>;

    if (!keyInfo.isEnvKey) {
      const ok = getDb().transaction(() => deductCredit(keyInfo.key, creditCost))();
      if (!ok) {
        return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: creditCost }, 402);
      }
      trackDelegatedSpend(keyInfo, creditCost);
    }

    return c.json({ ...result, creditsCharged: creditCost, model });
  } catch (err) {
    logger.error({ err }, 'Embeddings proxy error');
    return c.json({ error: 'Embeddings request failed', details: String(err) }, 500);
  }
});

// ─── POST /v1/llm/code/run — sandboxed code execution via x402engine ──────────

const CodeRunSchema = z.object({
  code: z.string().max(50000),
  language: z.enum(['python', 'javascript', 'typescript']).default('python'),
  timeout: z.number().int().min(1).max(30).default(10),
  packages: z.string().optional(),
});

llmRouter.post('/code/run', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const parsed = CodeRunSchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, 400);

  const creditCost = 10; // 10 credits per sandbox run

  if (!keyInfo.isEnvKey && keyInfo.credits < creditCost) {
    return c.json({ error: 'Insufficient credits', creditsRequired: creditCost, creditsAvailable: keyInfo.credits }, 402);
  }

  try {
    const result = await clawApiCall('/api/code/run', parsed.data, X402ENGINE_BASE);

    if (!keyInfo.isEnvKey) {
      const ok = getDb().transaction(() => deductCredit(keyInfo.key, creditCost))();
      if (!ok) {
        return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: creditCost }, 402);
      }
      trackDelegatedSpend(keyInfo, creditCost);
    }

    return c.json({ ...(result as object), creditsCharged: creditCost });
  } catch (err) {
    logger.error({ err }, 'Code run proxy error');
    return c.json({ error: 'Code execution failed', details: String(err) }, 500);
  }
});
