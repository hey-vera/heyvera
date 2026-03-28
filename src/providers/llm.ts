import { env } from '../config/index';
import { logger } from '../utils/logger';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
}

const TIMEOUT_MS = 30000;

// Singleton clients — avoid re-creating on every call
let _anthropicClient: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null;
let _openaiClient: InstanceType<typeof import('openai').default> | null = null;

async function callAnthropic(messages: LlmMessage[], role: 'intent' | 'synthesis'): Promise<LlmResponse> {
  if (!_anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  const client = _anthropicClient;

  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const model = role === 'intent' ? env.ANTHROPIC_INTENT_MODEL : env.ANTHROPIC_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0,
      system,
      messages: userMessages,
    }, { signal: controller.signal });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    return {
      content,
      provider: 'anthropic',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(messages: LlmMessage[], role: 'intent' | 'synthesis'): Promise<LlmResponse> {
  if (!_openaiClient) {
    const { default: OpenAI } = await import('openai');
    _openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  const client = _openaiClient;

  const model = role === 'intent' ? env.OPENAI_INTENT_MODEL : env.OPENAI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0,
    }, { signal: controller.signal });

    return {
      content: response.choices[0]?.message?.content ?? '',
      provider: 'openai',
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenClaw(messages: LlmMessage[], _role: 'intent' | 'synthesis'): Promise<LlmResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${env.OPENCLAW_API_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.OPENCLAW_API_KEY && { Authorization: `Bearer ${env.OPENCLAW_API_KEY}` }) },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenClaw error: ${response.status}`);
    const data = await response.json() as { content: string };
    return { content: data.content, provider: 'openclaw' };
  } finally {
    clearTimeout(timer);
  }
}

export async function llmComplete(messages: LlmMessage[], role: 'intent' | 'synthesis' = 'synthesis'): Promise<LlmResponse> {
  // Phase 2: Try heart.generate() first — routes LLM calls through Soma Heart
  // for per-token HMAC authentication and heartbeat chain entries.
  // Falls back to direct SDK calls if heart is unavailable or fails.
  try {
    const { heartLlmComplete } = await import('../core/soma');
    const heartResult = await heartLlmComplete(messages, role);
    if (heartResult) {
      return {
        content: heartResult.content,
        provider: 'soma-heart',
        outputTokens: heartResult.tokenCount,
      };
    }
  } catch {
    // Heart not available — fall through to direct SDK calls
  }

  const providers: Array<() => Promise<LlmResponse>> = [];

  if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) providers.push(() => callAnthropic(messages, role));
  if (env.LLM_PROVIDER === 'openai' && env.OPENAI_API_KEY) providers.push(() => callOpenAI(messages, role));
  if (env.LLM_PROVIDER === 'openclaw') providers.push(() => callOpenClaw(messages, role));

  // Fallbacks
  if (env.ANTHROPIC_API_KEY && env.LLM_PROVIDER !== 'anthropic') providers.push(() => callAnthropic(messages, role));
  if (env.OPENAI_API_KEY && env.LLM_PROVIDER !== 'openai') providers.push(() => callOpenAI(messages, role));

  if (providers.length === 0) {
    throw new Error('No LLM providers configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env');
  }

  for (const provider of providers) {
    try {
      return await provider();
    } catch (err) {
      logger.warn({ err }, 'LLM provider failed, trying next');
    }
  }

  throw new Error('ALL_PROVIDERS_FAILED');
}
