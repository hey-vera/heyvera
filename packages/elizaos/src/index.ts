/**
 * @clawnet/elizaos — ClawNet plugin for ElizaOS
 *
 * 3 actions for any ElizaOS agent:
 *   - CLAWNET_ORCHESTRATE  — query 390+ APIs via AI orchestration
 *   - CLAWNET_INVOKE_SKILL — invoke a specific marketplace skill
 *   - CLAWNET_SEARCH       — search endpoints and skills
 *
 * Usage:
 *   import { clawnetPlugin } from '@clawnet/elizaos';
 *
 *   // Add to your character config
 *   const character = {
 *     plugins: [clawnetPlugin],
 *     settings: { secrets: { CLAWNET_API_KEY: 'cn-xxxx' } },
 *   };
 */

// ─── Types (ElizaOS-compatible, no runtime dependency) ─────────────────────

interface ElizaAction {
  name: string;
  description: string;
  similes: string[];
  examples: Array<Array<{ user: string; content: { text: string } }>>;
  validate: (runtime: any, message: any) => Promise<boolean>;
  handler: (
    runtime: any,
    message: any,
    state: any,
    options: any,
    callback: (response: { text: string; action?: string }) => void,
  ) => Promise<void>;
}

interface ElizaPlugin {
  name: string;
  description: string;
  actions: ElizaAction[];
}

// ─── HTTP helper ───────────────────────────────────────────────────────────

const BASE_URL = 'https://claw-net.org';

async function clawnetFetch(
  runtime: any,
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const apiKey = runtime.getSetting('CLAWNET_API_KEY');
  if (!apiKey) throw new Error('CLAWNET_API_KEY not configured');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `ClawNet API error: ${res.status}`);
  }

  return res.json();
}

// ─── Action 1: CLAWNET_ORCHESTRATE ─────────────────────────────────────────

const orchestrateAction: ElizaAction = {
  name: 'CLAWNET_ORCHESTRATE',

  description:
    'Query ClawNet\'s AI orchestration engine with 390+ live APIs. ' +
    'Automatically selects endpoints, executes multi-step workflows, and returns a formatted answer. ' +
    'Use this when the user asks a question that requires real-time data from external APIs.',

  similes: ['QUERY_APIS', 'ASK_CLAWNET', 'AI_ORCHESTRATE', 'SEARCH_APIS'],

  examples: [
    [
      { user: '{{user1}}', content: { text: 'What is the current price of SOL?' } },
      { user: '{{agent}}', content: { text: 'I\'ll check the current SOL price through ClawNet\'s API network.' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'Find trending GitHub repos about AI agents' } },
      { user: '{{agent}}', content: { text: 'Let me search for trending AI agent repositories through ClawNet.' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'Get the weather in Tokyo and the latest crypto news' } },
      { user: '{{agent}}', content: { text: 'I\'ll orchestrate multiple API calls to get Tokyo weather and crypto news for you.' } },
    ],
  ],

  async validate(runtime: any, _message: any): Promise<boolean> {
    const apiKey = runtime.getSetting('CLAWNET_API_KEY');
    return typeof apiKey === 'string' && apiKey.length > 0;
  },

  async handler(runtime, message, _state, _options, callback): Promise<void> {
    try {
      const query = message.content?.text ?? message.content;
      if (!query || typeof query !== 'string') {
        callback({ text: 'I need a question or task to orchestrate. What would you like to know?' });
        return;
      }

      const result = await clawnetFetch(runtime, '/v1/orchestrate', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });

      const steps = result.steps?.length ?? 0;
      const credits = result.metadata?.totalCredits ?? result.totalCredits ?? 'unknown';
      const duration = result.metadata?.durationMs ?? result.durationMs;

      let response = result.answer || JSON.stringify(result.result ?? result.data);

      if (steps > 0 || credits !== 'unknown') {
        const parts: string[] = [];
        if (steps > 0) parts.push(`${steps} API${steps > 1 ? 's' : ''} called`);
        if (credits !== 'unknown') parts.push(`${credits} credits used`);
        if (duration) parts.push(`${duration}ms`);
        response += `\n\n(${parts.join(' | ')})`;
      }

      callback({ text: response });
    } catch (err: any) {
      callback({ text: `ClawNet orchestration failed: ${err.message}` });
    }
  },
};

// ─── Action 2: CLAWNET_INVOKE_SKILL ────────────────────────────────────────

const invokeSkillAction: ElizaAction = {
  name: 'CLAWNET_INVOKE_SKILL',

  description:
    'Invoke a specific ClawNet marketplace skill by ID. Skills are pre-built AI capabilities ' +
    'like crypto trust scoring, data enrichment, context analysis, and more. ' +
    'Parse the skill ID and any variables from the user message. ' +
    'Format: "invoke skill <id>" or "invoke skill <id> with key=value,key2=value2".',

  similes: ['USE_SKILL', 'RUN_SKILL', 'EXECUTE_SKILL', 'CALL_SKILL'],

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Invoke skill vie-crypto-trust with token=SOL' } },
      { user: '{{agent}}', content: { text: 'Running the crypto trust analysis skill for SOL...' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'Run the context-engine skill with query=ethereum merge' } },
      { user: '{{agent}}', content: { text: 'Invoking the context engine to analyze the Ethereum merge topic.' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'Use skill sol-price-feed with token=SOL&interval=1h' } },
      { user: '{{agent}}', content: { text: 'Fetching SOL price data with 1-hour intervals from the marketplace.' } },
    ],
  ],

  async validate(runtime: any, _message: any): Promise<boolean> {
    const apiKey = runtime.getSetting('CLAWNET_API_KEY');
    return typeof apiKey === 'string' && apiKey.length > 0;
  },

  async handler(runtime, message, _state, _options, callback): Promise<void> {
    try {
      const text: string = message.content?.text ?? message.content ?? '';

      // Parse skill ID: look for "skill <id>" pattern
      const skillMatch = text.match(/skill\s+([\w-]+)/i);
      if (!skillMatch) {
        callback({
          text: 'Please specify a skill ID. Example: "invoke skill vie-crypto-trust with token=SOL"\n' +
               'Use CLAWNET_SEARCH to find available skills.',
        });
        return;
      }

      const skillId = skillMatch[1];

      // Parse variables: "with key=value,key2=value2" or "key=value&key2=value2"
      const variables: Record<string, string> = {};
      const varsMatch = text.match(/(?:with|params?|variables?)\s+(.+)$/i);
      if (varsMatch) {
        const varsStr = varsMatch[1];
        // Support both key=value,key2=value2 and key=value&key2=value2
        const pairs = varsStr.split(/[,&]\s*/);
        for (const pair of pairs) {
          const [key, ...rest] = pair.split('=');
          if (key && rest.length > 0) {
            variables[key.trim()] = rest.join('=').trim();
          }
        }
      }

      const result = await clawnetFetch(
        runtime,
        `/v1/skills/${encodeURIComponent(skillId)}/invoke`,
        {
          method: 'POST',
          body: JSON.stringify({ variables }),
        },
      );

      const answer = result.answer ?? result.result ?? result.data;
      const creditCost = result.creditCost;
      const displayAnswer = typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2);

      let response = displayAnswer;
      if (creditCost !== undefined) {
        response += `\n\n(Skill: ${skillId} | Cost: ${creditCost} credits)`;
      }

      callback({ text: response });
    } catch (err: any) {
      callback({ text: `Skill invocation failed: ${err.message}` });
    }
  },
};

// ─── Action 3: CLAWNET_SEARCH ──────────────────────────────────────────────

const searchAction: ElizaAction = {
  name: 'CLAWNET_SEARCH',

  description:
    'Search ClawNet\'s skill marketplace and endpoint registry. Find available AI capabilities ' +
    'by keyword. Returns matching skills with IDs, descriptions, and pricing. ' +
    'Use this to discover what skills are available before invoking them.',

  similes: ['FIND_APIS', 'BROWSE_SKILLS', 'SEARCH_MARKETPLACE', 'LIST_SKILLS'],

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Search for crypto price skills on ClawNet' } },
      { user: '{{agent}}', content: { text: 'Let me search the ClawNet marketplace for crypto price skills.' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'What skills are available for data enrichment?' } },
      { user: '{{agent}}', content: { text: 'Searching ClawNet for data enrichment capabilities...' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'Find me an API for sentiment analysis' } },
      { user: '{{agent}}', content: { text: 'Looking for sentiment analysis tools in the ClawNet marketplace.' } },
    ],
  ],

  async validate(runtime: any, _message: any): Promise<boolean> {
    const apiKey = runtime.getSetting('CLAWNET_API_KEY');
    return typeof apiKey === 'string' && apiKey.length > 0;
  },

  async handler(runtime, message, _state, _options, callback): Promise<void> {
    try {
      const text: string = message.content?.text ?? message.content ?? '';

      // Extract search query — strip common prefixes
      const query = text
        .replace(/^(search|find|browse|list|look for|show me|what)\s+(for\s+|me\s+)?/i, '')
        .replace(/\s+(on|in|from)\s+clawnet$/i, '')
        .replace(/\s+skills?$/i, '')
        .replace(/\s+apis?$/i, '')
        .trim() || text;

      const result = await clawnetFetch(
        runtime,
        `/v1/marketplace/skills?search=${encodeURIComponent(query)}&limit=5`,
        { method: 'GET' },
      );

      const skills = result.skills ?? result ?? [];

      if (!Array.isArray(skills) || skills.length === 0) {
        callback({
          text: `No skills found for "${query}". Try a different search term, or use CLAWNET_ORCHESTRATE to query directly.`,
        });
        return;
      }

      const lines = skills.map((s: any, i: number) => {
        const cost = s.credit_cost ?? s.creditCost ?? '?';
        const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : '';
        return `${i + 1}. **${s.name}** (ID: \`${s.id}\`) — ${cost} credits${tags}\n   ${s.description || 'No description'}`;
      });

      callback({
        text: `Found ${skills.length} skill${skills.length > 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n\n')}\n\nUse "invoke skill <id>" to run any of these.`,
      });
    } catch (err: any) {
      callback({ text: `Skill search failed: ${err.message}` });
    }
  },
};

// ─── Plugin export ─────────────────────────────────────────────────────────

export const clawnetPlugin: ElizaPlugin = {
  name: 'clawnet',
  description:
    'ClawNet AI agent orchestration — 390+ APIs, skill marketplace, cryptographic receipts',
  actions: [orchestrateAction, invokeSkillAction, searchAction],
};

export default clawnetPlugin;

// Named exports for individual actions
export { orchestrateAction, invokeSkillAction, searchAction };
