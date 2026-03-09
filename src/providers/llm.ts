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

async function callAnthropic(messages: LlmMessage[]): Promise<LlmResponse> {
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

const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    temperature: 0,
    system,
    messages: userMessages,
  });

  const content = response.content[0].type === 'text' ? response.content[0].text : '';
  return {
    content,
    provider: 'anthropic',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function callOpenAI(messages: LlmMessage[]): Promise<LlmResponse> {
  if (!_openaiClient) {
    const { default: OpenAI } = await import('openai');
    _openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  const client = _openaiClient;

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages,
    max_tokens: 2048,
    temperature: 0,
  });

  return {
    content: response.choices[0]?.message?.content ?? '',
    provider: 'openai',
    inputTokens: response.usage?.prompt_tokens,
    outputTokens: response.usage?.completion_tokens,
  };
}

async function callOpenClaw(messages: LlmMessage[]): Promise<LlmResponse> {
  const response = await fetch(`${env.OPENCLAW_API_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(env.OPENCLAW_API_KEY && { Authorization: `Bearer ${env.OPENCLAW_API_KEY}` }) },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) throw new Error(`OpenClaw error: ${response.status}`);
  const data = await response.json() as { content: string };
  return { content: data.content, provider: 'openclaw' };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LLM timeout after ${ms}ms`)), ms);
    }),
  ]);
}

export async function llmComplete(messages: LlmMessage[]): Promise<LlmResponse> {
  const providers: Array<() => Promise<LlmResponse>> = [];

  if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) providers.push(() => callAnthropic(messages));
  if (env.LLM_PROVIDER === 'openai' && env.OPENAI_API_KEY) providers.push(() => callOpenAI(messages));
  if (env.LLM_PROVIDER === 'openclaw') providers.push(() => callOpenClaw(messages));

  // Fallbacks
  if (env.ANTHROPIC_API_KEY && env.LLM_PROVIDER !== 'anthropic') providers.push(() => callAnthropic(messages));
  if (env.OPENAI_API_KEY && env.LLM_PROVIDER !== 'openai') providers.push(() => callOpenAI(messages));

  if (providers.length === 0) {
    throw new Error('No LLM providers configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env');
  }

  for (const provider of providers) {
    try {
      return await withTimeout(provider(), TIMEOUT_MS);
    } catch (err) {
      logger.warn({ err }, 'LLM provider failed, trying next');
    }
  }

  throw new Error('ALL_PROVIDERS_FAILED');
}