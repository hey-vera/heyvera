/**
 * OpenAPI 3.0 Spec — GET /v1/openapi.json
 * Auto-generated from the API registry. Enables SDK generation via openapi-generator.
 * No auth required — spec is public documentation.
 */
import { Hono } from 'hono';
import { apiRegistry } from '../config/api-registry';

export const openapiRouter = new Hono();

const errRef = { $ref: '#/components/schemas/Error' };
const errContent = { 'application/json': { schema: errRef } };
const err402 = { description: 'Insufficient credits', content: errContent };
const err429 = { description: 'Rate limited', content: errContent };
const err401 = { description: 'Unauthorized', content: errContent };

openapiRouter.get('/openapi.json', (c) => {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'ClawNet API',
      description: 'Sovereign AI agent orchestration layer. 390 endpoints, pay-per-use credits, agent-native primitives. One key, one query, done.',
      version: '3.0.0',
      contact: {
        name: 'ClawNet',
        url: 'https://claw-net.org',
        email: 'support@claw-net.org',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      { url: 'https://api.claw-net.org', description: 'Production' },
      { url: 'http://localhost:3402', description: 'Local development' },
    ],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key obtained from claw-net.org after purchasing credits',
        },
        ClerkAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Clerk JWT token for dashboard and escrow endpoints',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            hint: { type: 'string' },
          },
          required: ['error'],
        },
        OrchestrationResponse: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            answer: { type: 'string' },
            opportunityScore: { type: 'number', minimum: 0, maximum: 100 },
            riskScore: { type: 'number', minimum: 0, maximum: 100 },
            suggestedActions: { type: 'array', items: { type: 'string' } },
            costBreakdown: {
              type: 'object',
              properties: {
                costUsd: { type: 'number' },
                creditsUsed: { type: 'number' },
                savings: { type: 'number' },
              },
            },
            metadata: {
              type: 'object',
              properties: {
                stepsExecuted: { type: 'integer' },
                cacheHits: { type: 'integer' },
                totalDurationMs: { type: 'integer' },
                llmProvider: { type: 'string' },
                simulationMode: { type: 'boolean' },
              },
            },
          },
          required: ['requestId', 'answer'],
        },
        BatchResponse: {
          type: 'object',
          properties: {
            batchId: { type: 'string' },
            totalQueries: { type: 'integer' },
            succeeded: { type: 'integer' },
            failed: { type: 'integer' },
            totalDurationMs: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  query: { type: 'string' },
                  ok: { type: 'boolean' },
                  answer: { type: 'string' },
                  error: { type: 'string' },
                  creditsUsed: { type: 'integer' },
                  durationMs: { type: 'integer' },
                },
              },
            },
          },
        },
        Skill: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            displayName: { type: 'string' },
            description: { type: 'string' },
            creditCost: { type: 'integer' },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            author: { type: 'string' },
            version: { type: 'integer' },
            stars: { type: 'integer' },
          },
        },
      },
    },
    paths: {
      // ── Core ────────────────────────────────────────────────────────
      '/v1/orchestrate': {
        post: {
          summary: 'Orchestrate a query',
          description: 'Send a natural-language query. The AI planner selects the best API endpoints, executes them (with caching), and returns a structured answer.',
          operationId: 'orchestrate',
          tags: ['Core'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', maxLength: 2000, example: 'What is the price and risk score for SOL?' },
                  },
                  required: ['query'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Successful orchestration', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrchestrationResponse' } } } },
            '402': err402,
            '429': err429,
          },
        },
      },
      '/v1/batch': {
        post: {
          summary: 'Batch orchestrate multiple queries',
          description: 'Run up to 10 independent queries in parallel. Billed per query.',
          operationId: 'batchOrchestrate',
          tags: ['Core'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    queries: { type: 'array', items: { type: 'string', maxLength: 2000 }, minItems: 1, maxItems: 10 },
                  },
                  required: ['queries'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Batch results', content: { 'application/json': { schema: { $ref: '#/components/schemas/BatchResponse' } } } },
            '402': err402,
          },
        },
      },
      '/v1/stream/orchestrate': {
        get: {
          summary: 'Stream orchestration via SSE',
          description: 'Real-time Server-Sent Events stream. Emits start, plan, step, done, and error events.',
          operationId: 'streamOrchestrate',
          tags: ['Core'],
          parameters: [
            { name: 'query', in: 'query', required: true, schema: { type: 'string', maxLength: 2000 } },
          ],
          responses: {
            '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
          },
        },
      },
      '/v1/estimate': {
        get: {
          summary: 'Estimate credit cost for a query',
          description: 'Runs intent parsing only (no execution, no credit charge) and returns the estimated credits.',
          operationId: 'estimateQuery',
          tags: ['Core'],
          security: [],
          parameters: [
            { name: 'query', in: 'query', required: true, schema: { type: 'string', maxLength: 2000 } },
          ],
          responses: {
            '200': {
              description: 'Estimated credit cost breakdown',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string' },
                      estimatedCredits: { type: 'integer' },
                      steps: { type: 'integer' },
                      summary: { type: 'string' },
                      breakdown: { type: 'array', items: { type: 'object', properties: { endpointId: { type: 'string' }, credits: { type: 'integer' }, reason: { type: 'string' } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // ── Account ─────────────────────────────────────────────────────
      '/v1/balance': {
        get: {
          summary: 'Get credit balance',
          operationId: 'getBalance',
          tags: ['Account'],
          responses: {
            '200': {
              description: 'Current balance',
              content: { 'application/json': { schema: { type: 'object', properties: { credits: { type: 'integer' }, creditsUsed: { type: 'integer' }, memberSince: { type: 'string', format: 'date-time' } } } } },
            },
            '401': err401,
          },
        },
      },
      '/v1/auth/me': {
        get: {
          summary: 'Get current API key info',
          operationId: 'getMe',
          tags: ['Account'],
          responses: {
            '200': { description: 'API key details including credits, tier, and usage' },
            '401': err401,
          },
        },
      },
      '/v1/auth/usage': {
        get: {
          summary: 'Get API key usage history',
          operationId: 'getUsage',
          tags: ['Account'],
          responses: {
            '200': { description: 'Usage breakdown by day' },
          },
        },
      },
      // ── Skills ──────────────────────────────────────────────────────
      '/v1/skills': {
        get: {
          summary: 'List public skills',
          description: 'Returns paginated list of public, active skills. Supports search, category filter, and sorting.',
          operationId: 'listSkills',
          tags: ['Skills'],
          security: [],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['popular', 'newest', 'name'] } },
          ],
          responses: {
            '200': { description: 'Paginated skill list', content: { 'application/json': { schema: { type: 'object', properties: { skills: { type: 'array', items: { $ref: '#/components/schemas/Skill' } }, total: { type: 'integer' }, page: { type: 'integer' }, pages: { type: 'integer' } } } } } },
          },
        },
        post: {
          summary: 'Create a new skill',
          operationId: 'createSkill',
          tags: ['Skills'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, displayName: { type: 'string' }, description: { type: 'string' }, promptTemplate: { type: 'string' }, creditCost: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string' } }, required: ['name', 'description', 'promptTemplate', 'creditCost'] } } } },
          responses: { '201': { description: 'Skill created' }, '400': { description: 'Validation error', content: errContent } },
        },
      },
      '/v1/skills/{id}/invoke': {
        post: {
          summary: 'Invoke a skill',
          description: 'Execute a skill with provided template variables. Charges the skill credit cost.',
          operationId: 'invokeSkill',
          tags: ['Skills'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { variables: { type: 'object', additionalProperties: { type: 'string' } } } } } } },
          responses: {
            '200': { description: 'Skill execution result' },
            '402': err402,
            '404': { description: 'Skill not found', content: errContent },
          },
        },
      },
      // ── Marketplace ─────────────────────────────────────────────────
      '/v1/marketplace/skills': {
        get: {
          summary: 'Browse marketplace skills',
          description: 'Public marketplace listing with search, sort, and category filters.',
          operationId: 'browseMarketplace',
          tags: ['Marketplace'],
          security: [],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['popular', 'newest', 'price_asc', 'price_desc', 'rating'] } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: { '200': { description: 'Marketplace skill listing' } },
        },
      },
      '/v1/marketplace/skills/{id}/purchase': {
        post: {
          summary: 'Purchase and execute a marketplace skill',
          operationId: 'purchaseSkill',
          tags: ['Marketplace'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Purchase + execution result' }, '402': err402, '404': { description: 'Skill not found', content: errContent } },
        },
      },
      // ── Tasks ───────────────────────────────────────────────────────
      '/v1/tasks': {
        post: {
          summary: 'Create a task',
          description: 'Submit a skill execution as an async task with optional webhook callback.',
          operationId: 'createTask',
          tags: ['Tasks'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { skillId: { type: 'string' }, variables: { type: 'object' }, webhookUrl: { type: 'string', format: 'uri' }, idempotencyKey: { type: 'string' } }, required: ['skillId'] } } } },
          responses: { '201': { description: 'Task created' }, '402': err402 },
        },
        get: {
          summary: 'List tasks',
          operationId: 'listTasks',
          tags: ['Tasks'],
          responses: { '200': { description: 'Task list' } },
        },
      },
      '/v1/tasks/{id}': {
        get: {
          summary: 'Get task status',
          operationId: 'getTask',
          tags: ['Tasks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Task details' }, '404': { description: 'Task not found', content: errContent } },
        },
      },
      // ── Discovery ───────────────────────────────────────────────────
      '/v1/registry': {
        get: {
          summary: 'List available API endpoints',
          description: 'Returns all endpoints in the orchestration registry, grouped by category.',
          operationId: 'getRegistry',
          tags: ['Discovery'],
          security: [],
          responses: {
            '200': { description: 'Registry of available endpoints', content: { 'application/json': { schema: { type: 'object', properties: { totalEndpoints: { type: 'integer', example: apiRegistry.length }, categories: { type: 'object', additionalProperties: { type: 'array', items: { type: 'object' } } } } } } } },
          },
        },
      },
      '/v1/discover': {
        post: {
          summary: 'Semantic skill discovery',
          description: 'Search skills using natural language via embedding similarity (Trinity engine: semantic 60% + p2p 25% + onchain 15%).',
          operationId: 'discoverSkills',
          tags: ['Discovery'],
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } }, required: ['query'] } } } },
          responses: { '200': { description: 'Ranked skill matches' }, '503': { description: 'Embedding model loading', content: errContent } },
        },
      },
      // ── Governance ──────────────────────────────────────────────────
      '/v1/governance/proposals': {
        get: {
          summary: 'List governance proposals',
          operationId: 'listProposals',
          tags: ['Governance'],
          security: [],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'CLOSED', 'EXECUTED'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          ],
          responses: { '200': { description: 'Paginated proposal list' } },
        },
      },
      '/v1/governance/propose': {
        post: {
          summary: 'Create a governance proposal',
          operationId: 'createProposal',
          tags: ['Governance'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, closeDays: { type: 'integer', default: 7 } }, required: ['title', 'description'] } } } },
          responses: { '201': { description: 'Proposal created' }, '403': { description: 'Insufficient credits to propose', content: errContent } },
        },
      },
      '/v1/governance/proposals/{id}/vote': {
        post: {
          summary: 'Vote on a proposal',
          operationId: 'castVote',
          tags: ['Governance'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { direction: { type: 'string', enum: ['FOR', 'AGAINST'] } }, required: ['direction'] } } } },
          responses: { '200': { description: 'Vote recorded' }, '400': { description: 'Vote failed', content: errContent } },
        },
      },
      // ── Escrow ──────────────────────────────────────────────────────
      '/v1/escrow': {
        get: {
          summary: 'List escrows for current user',
          description: 'Returns escrows where the caller is hirer or worker.',
          operationId: 'listEscrows',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          responses: { '200': { description: 'Escrow list' }, '401': err401 },
        },
      },
      '/v1/escrow/create': {
        post: {
          summary: 'Create an escrow',
          description: 'Creates a new escrow agreement between a hirer and worker. Credits are not locked until /fund is called.',
          operationId: 'createEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    workerId: { type: 'string', description: 'Worker\'s API key or user ID' },
                    amountCredits: { type: 'number', minimum: 1, description: 'Credits to lock in escrow' },
                    deadline: { type: 'string', format: 'date-time', description: 'ISO datetime when escrow expires' },
                    metadata: { type: 'object', description: 'Optional metadata about the work' },
                  },
                  required: ['workerId', 'amountCredits', 'deadline'],
                },
              },
            },
          },
          responses: { '201': { description: 'Escrow created' }, '400': { description: 'Validation error', content: errContent }, '401': err401 },
        },
      },
      '/v1/escrow/{id}/fund': {
        post: {
          summary: 'Fund an escrow',
          description: 'Locks credits from hirer\'s balance. Transitions CREATED → FUNDED.',
          operationId: 'fundEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Escrow funded' }, '402': err402, '401': err401 },
        },
      },
      '/v1/escrow/{id}/start': {
        post: {
          summary: 'Start work on an escrow',
          description: 'Worker acknowledges they have started. Transitions FUNDED → WORK_IN_PROGRESS.',
          operationId: 'startEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Work started' }, '401': err401 },
        },
      },
      '/v1/escrow/{id}/complete': {
        post: {
          summary: 'Mark work as complete',
          description: 'Worker submits deliverable. Transitions WORK_IN_PROGRESS → COMPLETED.',
          operationId: 'completeEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { deliverableUrl: { type: 'string', format: 'uri' }, notes: { type: 'string' } } } } } },
          responses: { '200': { description: 'Completed' }, '401': err401 },
        },
      },
      '/v1/escrow/{id}/release': {
        post: {
          summary: 'Release escrow funds to worker',
          description: 'Hirer approves the work. Credits transfer to worker. Transitions COMPLETED → RELEASED.',
          operationId: 'releaseEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Funds released' }, '401': err401 },
        },
      },
      '/v1/escrow/{id}/dispute': {
        post: {
          summary: 'Open a dispute',
          description: 'Either party can raise a dispute. Transitions to DISPUTED state for admin review.',
          operationId: 'disputeEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string', maxLength: 1000 } }, required: ['reason'] } } } },
          responses: { '200': { description: 'Dispute opened' }, '401': err401 },
        },
      },
      '/v1/escrow/{id}': {
        get: {
          summary: 'Get escrow details',
          operationId: 'getEscrow',
          tags: ['Escrow'],
          security: [{ ClerkAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Escrow details' }, '404': { description: 'Not found', content: errContent } },
        },
      },
      // ── Swarm ────────────────────────────────────────────────────────
      '/v1/swarm/task': {
        post: {
          summary: 'Run a swarm task',
          description: 'Decomposes a complex goal into parallel sub-tasks using LLM planning, then executes them across the skill network. Charges SWARM_BASE_FEE (20cr) upfront plus per-subtask costs.',
          operationId: 'runSwarmTask',
          tags: ['Swarm'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    goal: { type: 'string', maxLength: 2000, description: 'High-level goal for the swarm to achieve' },
                    maxBudget: { type: 'integer', minimum: 20, description: 'Maximum credits to spend (must be ≥ 20 for base fee)' },
                    strategy: { type: 'string', enum: ['cheapest', 'balanced', 'fastest', 'reliable'], default: 'balanced' },
                  },
                  required: ['goal'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Swarm task results with sub-task breakdown' },
            '402': err402,
            '429': err429,
          },
        },
      },
      '/v1/swarm/{id}': {
        get: {
          summary: 'Get swarm task status',
          operationId: 'getSwarmTask',
          tags: ['Swarm'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Swarm task details' }, '404': { description: 'Not found', content: errContent } },
        },
      },
      // ── LLM Proxy ────────────────────────────────────────────────────
      '/v1/llm/models': {
        get: {
          summary: 'List available LLM models',
          description: 'Returns all models available through the LLM proxy gateway with credit costs and capabilities.',
          operationId: 'listLlmModels',
          tags: ['LLM Proxy'],
          security: [],
          responses: {
            '200': {
              description: 'Available models',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      models: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            provider: { type: 'string' },
                            creditCost: { type: 'integer', description: 'Credits per 1K tokens' },
                            contextWindow: { type: 'integer' },
                            capabilities: { type: 'array', items: { type: 'string' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/llm/chat': {
        post: {
          summary: 'Chat completion (OpenAI-compatible)',
          description: 'OpenAI-compatible chat completions endpoint. Supports 23 models via the ClawNet LLM proxy. Billed in credits per 1K tokens with 15% platform markup.',
          operationId: 'llmChat',
          tags: ['LLM Proxy'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    model: { type: 'string', description: 'Model ID from /v1/llm/models (e.g. claude-sonnet-4-6, gpt-4o)' },
                    messages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                          content: { type: 'string' },
                        },
                        required: ['role', 'content'],
                      },
                    },
                    maxTokens: { type: 'integer' },
                    temperature: { type: 'number', minimum: 0, maximum: 2 },
                  },
                  required: ['model', 'messages'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Chat completion result with creditsCharged' },
            '402': err402,
            '400': { description: 'Invalid model or parameters', content: errContent },
          },
        },
      },
      '/v1/llm/embeddings': {
        post: {
          summary: 'Generate embeddings',
          description: 'Generate vector embeddings for text using the specified embedding model.',
          operationId: 'llmEmbeddings',
          tags: ['LLM Proxy'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    model: { type: 'string' },
                    input: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
                  },
                  required: ['model', 'input'],
                },
              },
            },
          },
          responses: { '200': { description: 'Embedding vectors' }, '402': err402 },
        },
      },
      // ── x402 ─────────────────────────────────────────────────────────
      '/x402': {
        get: {
          summary: 'x402 provider info',
          description: 'Returns x402 payment provider metadata: supported networks, USDC recipient, and skill count.',
          operationId: 'getX402Info',
          tags: ['x402'],
          security: [],
          responses: { '200': { description: 'x402 provider metadata' } },
        },
      },
      '/x402/skills': {
        get: {
          summary: 'List skills available via x402',
          description: 'Returns public skills that can be invoked using USDC micropayments on Base via the x402 protocol.',
          operationId: 'listX402Skills',
          tags: ['x402'],
          security: [],
          responses: { '200': { description: 'x402-enabled skill list with USDC prices' } },
        },
      },
      '/x402/skills/{id}': {
        post: {
          summary: 'Invoke a skill via x402 micropayment',
          description: 'Invoke a skill by paying with USDC on Base. Requires a valid x402 payment header.',
          operationId: 'invokeX402Skill',
          tags: ['x402'],
          security: [],
          'x-payment-info': { protocols: 'x402', pricingMode: 'fixed', price: '0.002', currency: 'USDC', network: 'eip155:8453' },
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { variables: { type: 'object', description: 'Key-value pairs for skill template variables', additionalProperties: { type: 'string' } } } } } } },
          responses: {
            '200': { description: 'Skill result', content: { 'application/json': { schema: { type: 'object', properties: { answer: { type: 'string' }, creditsCharged: { type: 'number' }, metadata: { type: 'object' } } } } } },
            '402': { description: 'Payment required — response includes x402 payment details in PAYMENT-REQUIRED header' },
          },
        },
      },
      '/x402/orchestrate': {
        post: {
          summary: 'AI orchestration via x402 micropayment',
          description: 'Send a natural language query. ClawNet routes to optimal APIs and returns a synthesized answer. Pay with USDC on Base.',
          operationId: 'x402Orchestrate',
          tags: ['x402'],
          security: [],
          'x-payment-info': { protocols: 'x402', pricingMode: 'fixed', price: '0.002', currency: 'USDC', network: 'eip155:8453' },
          requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Natural language question or task' } } } } } },
          responses: {
            '200': { description: 'Orchestration result', content: { 'application/json': { schema: { type: 'object', properties: { answer: { type: 'string' }, creditsCharged: { type: 'number' }, steps: { type: 'array', items: { type: 'object' } } } } } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/x402/query/{id}': {
        post: {
          summary: 'Query a data skill via x402 micropayment',
          description: 'Get structured data from a ClawNet data skill. Returns raw JSON, no LLM synthesis. Pay with USDC on Base.',
          operationId: 'x402QueryDataSkill',
          tags: ['x402'],
          security: [],
          'x-payment-info': { protocols: 'x402', pricingMode: 'fixed', price: '0.001', currency: 'USDC', network: 'eip155:8453' },
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string', description: 'Token symbol or mint address' } } } } } },
          responses: {
            '200': { description: 'Data skill result', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object' }, creditsCharged: { type: 'number' } } } } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      // ── Agent Context ─────────────────────────────────────────────────
      '/v1/context': {
        get: {
          summary: 'List agent context entries',
          description: 'Returns all cached context entries for the current API key. Context persists across requests to avoid re-fetching the same data.',
          operationId: 'listContext',
          tags: ['Agent Context'],
          responses: {
            '200': {
              description: 'Context entries',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      count: { type: 'integer' },
                      entries: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            endpointId: { type: 'string' },
                            category: { type: 'string' },
                            data: { type: 'object' },
                            fetchedAt: { type: 'string', format: 'date-time' },
                            expiresAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          summary: 'Clear all agent context',
          description: 'Deletes all context entries for the current API key.',
          operationId: 'clearContext',
          tags: ['Agent Context'],
          responses: { '200': { description: 'Context cleared' } },
        },
      },
      '/v1/context/stats': {
        get: {
          summary: 'Agent context usage stats',
          description: 'Returns entry count, total size, and oldest/newest entry timestamps for the current agent.',
          operationId: 'getContextStats',
          tags: ['Agent Context'],
          responses: { '200': { description: 'Context statistics' } },
        },
      },
      '/v1/context/{endpointId}': {
        delete: {
          summary: 'Delete a specific context entry',
          operationId: 'deleteContextEntry',
          tags: ['Agent Context'],
          parameters: [{ name: 'endpointId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Entry deleted' }, '404': { description: 'Entry not found', content: errContent } },
        },
      },
      // ── Mesh ────────────────────────────────────────────────────────
      '/v1/mesh/peers': {
        get: {
          summary: 'List mesh network peers',
          operationId: 'getMeshPeers',
          tags: ['Mesh'],
          responses: { '200': { description: 'Connected peers and node info' } },
        },
      },
      // ── Validators ──────────────────────────────────────────────
      '/v1/validators/verify': {
        post: {
          summary: 'Submit a validation verdict',
          description: 'Validators verify transaction results. Earns 0.5 credits per useful verification. Requires validator-promoted API key.',
          operationId: 'submitValidation',
          tags: ['Validators'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    transactionId: { type: 'string' },
                    verdict: { type: 'string', enum: ['VALID', 'INVALID', 'INCONCLUSIVE'] },
                    notes: { type: 'string', maxLength: 500 },
                  },
                  required: ['transactionId', 'verdict'],
                },
              },
            },
          },
          responses: {
            '201': { description: 'Validation recorded with reward credits' },
            '400': { description: 'Validation failed', content: errContent },
            '401': err401,
          },
        },
      },
      '/v1/validators/transaction/{txId}': {
        get: {
          summary: 'Get validations for a transaction',
          operationId: 'getTransactionValidations',
          tags: ['Validators'],
          parameters: [{ name: 'txId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Validation list for the transaction' } },
        },
      },
      '/v1/validators/skill/{skillId}': {
        get: {
          summary: 'Get validation stats for a skill',
          operationId: 'getSkillValidations',
          tags: ['Validators'],
          parameters: [{ name: 'skillId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Aggregated validation stats for the skill' } },
        },
      },
      '/v1/validators/history': {
        get: {
          summary: 'Get own validator stats',
          description: 'Returns validation history and stats for the current API key.',
          operationId: 'getValidatorStats',
          tags: ['Validators'],
          responses: { '200': { description: 'Validator stats and history' }, '401': err401 },
        },
      },
      '/v1/validators/leaderboard': {
        get: {
          summary: 'Get validator leaderboard',
          operationId: 'getValidatorLeaderboard',
          tags: ['Validators'],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } }],
          responses: { '200': { description: 'Top validators ranked by verification count' } },
        },
      },
      // ── Sessions ──────────────────────────────────────────────────
      '/v1/economy/sessions': {
        post: {
          summary: 'Create an agent session',
          description: 'Creates a persistent session to store state across requests. Env keys cannot create sessions.',
          operationId: 'createSession',
          tags: ['Economy'],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', maxLength: 100 } } } } } },
          responses: { '201': { description: 'Session created' }, '403': { description: 'Forbidden for env keys', content: errContent } },
        },
        get: {
          summary: 'List agent sessions',
          operationId: 'listSessions',
          tags: ['Economy'],
          responses: { '200': { description: 'Session list with count' } },
        },
      },
      '/v1/economy/sessions/{id}': {
        get: {
          summary: 'Get session details',
          operationId: 'getSession',
          tags: ['Economy'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Session details' }, '404': { description: 'Session not found', content: errContent } },
        },
        patch: {
          summary: 'Update session state',
          description: 'Merges the provided state object into the existing session state.',
          operationId: 'updateSessionState',
          tags: ['Economy'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { state: { type: 'object', additionalProperties: true } }, required: ['state'] } } } },
          responses: { '200': { description: 'Updated state' }, '404': { description: 'Session not found', content: errContent } },
        },
        delete: {
          summary: 'Delete a session',
          operationId: 'deleteSession',
          tags: ['Economy'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Session deleted' }, '404': { description: 'Session not found', content: errContent } },
        },
      },
      // ── Manifest ──────────────────────────────────────────────────
      '/v1/manifest': {
        post: {
          summary: 'Get a manifest — verify data, check reasoning, pre-flight actions',
          description: 'Universal data verification and decision support. One call, four checks, one verdict.',
          operationId: 'getManifest',
          tags: ['Manifest'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { check: { type: 'string', description: 'Natural language query' }, verify: { type: 'object' }, assess: { type: 'object' }, preflight: { type: 'object' }, tier: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' } } } } } },
          responses: { '200': { description: 'Manifest verdict with verification details' }, '402': err402 },
        },
      },
      '/v1/manifest/memory': {
        get: {
          summary: 'Query past manifests',
          operationId: 'queryManifestMemory',
          tags: ['Manifest'],
          parameters: [
            { name: 'subject', in: 'query', schema: { type: 'string' } },
            { name: 'verdict', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: { '200': { description: 'Past manifest history' } },
        },
      },
      '/v1/manifest/outcome': {
        post: {
          summary: 'Report outcome of a manifest decision',
          operationId: 'reportManifestOutcome',
          tags: ['Manifest'],
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { manifest_id: { type: 'string' }, outcome: { type: 'string', enum: ['positive', 'negative', 'neutral'] }, data: { type: 'object' }, value: { type: 'number' } }, required: ['manifest_id', 'outcome'] } } } },
          responses: { '200': { description: 'Outcome recorded' } },
        },
      },
      // ── Attestation ──────────────────────────────────────────────
      '/v1/attest': {
        post: {
          summary: 'Create an explicit attestation',
          description: 'Creates a signed, tamper-proof attestation for a custom agent action. Automatic attestations are created for free on every orchestration and skill invocation.',
          operationId: 'createAttestation',
          tags: ['Attestation'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { action: { type: 'string', description: 'Action being attested' }, input: { type: 'object', description: 'Input data to hash' }, result: { type: 'object', description: 'Result data to hash' }, metadata: { type: 'object', description: 'Optional metadata' } }, required: ['action'] } } } },
          responses: { '200': { description: 'Attestation created with cryptographic hashes and signature' }, '402': err402 },
        },
      },
      '/v1/attest/{id}': {
        get: {
          summary: 'Get an attestation by ID',
          description: 'Retrieve a specific attestation record. Requires the API key that created it.',
          operationId: 'getAttestation',
          tags: ['Attestation'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Attestation details' }, '404': { description: 'Attestation not found', content: errContent } },
        },
      },
      '/v1/attest/verify/{id}': {
        get: {
          summary: 'Verify an attestation (public)',
          description: 'Publicly verify the cryptographic integrity of an attestation. No auth required.',
          operationId: 'verifyAttestation',
          tags: ['Attestation'],
          security: [],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Verification result with signature validity and chain contiguity' }, '404': { description: 'Attestation not found', content: errContent } },
        },
      },
      '/v1/attest/history': {
        get: {
          summary: 'Get attestation history',
          description: 'Query past attestations for the current API key. Filter by action type, date range, and pagination.',
          operationId: 'getAttestationHistory',
          tags: ['Attestation'],
          parameters: [
            { name: 'action', in: 'query', schema: { type: 'string' }, description: 'Filter by action type' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'List of attestations' } },
        },
      },
      '/v1/attest/stats': {
        get: {
          summary: 'Get attestation statistics',
          description: 'Aggregated statistics for the current API key: total attestations, verification counts, integrity score.',
          operationId: 'getAttestationStats',
          tags: ['Attestation'],
          responses: { '200': { description: 'Attestation statistics' } },
        },
      },
      '/v1/attest/agent/{keyHash}': {
        get: {
          summary: 'Get attestations by agent key hash',
          description: 'Query attestations for a specific agent by their public key hash. Useful for cross-agent trust verification.',
          operationId: 'getAttestationsByAgent',
          tags: ['Attestation'],
          security: [],
          parameters: [
            { name: 'keyHash', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'List of attestations for the agent' } },
        },
      },
      // ── Admin ─────────────────────────────────────────────────────
      '/v1/admin/validators/promote': {
        post: {
          summary: 'Promote an API key to validator',
          description: 'Admin-only. Grants validator privileges to the specified API key.',
          operationId: 'promoteValidator',
          tags: ['Admin'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } } },
          responses: { '200': { description: 'Key promoted to validator' }, '404': { description: 'API key not found', content: errContent }, '409': { description: 'Already a validator', content: errContent } },
        },
      },
      '/v1/admin/validators/demote': {
        delete: {
          summary: 'Demote a validator',
          description: 'Admin-only. Revokes validator privileges from the specified API key.',
          operationId: 'demoteValidator',
          tags: ['Admin'],
          security: [{ ApiKeyAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } } },
          responses: { '200': { description: 'Validator demoted' }, '404': { description: 'Validator not found', content: errContent } },
        },
      },
      // ── System ──────────────────────────────────────────────────────
      '/health': {
        get: {
          summary: 'Root health check',
          operationId: 'healthCheckRoot',
          tags: ['System'],
          security: [],
          responses: { '200': { description: 'Service healthy' }, '503': { description: 'Service degraded' } },
        },
      },
      '/v1/health': {
        get: {
          summary: 'Detailed health check',
          description: 'Returns uptime, cache stats, simulation mode, and endpoint count.',
          operationId: 'healthCheckDetailed',
          tags: ['System'],
          security: [],
          responses: { '200': { description: 'Service healthy with details' }, '503': { description: 'Service degraded' } },
        },
      },
      '/v1/stats': {
        get: {
          summary: 'Public platform statistics',
          description: 'Aggregated stats for the homepage: total calls, success rate, active users, endpoint status.',
          operationId: 'getStats',
          tags: ['System'],
          security: [],
          responses: { '200': { description: 'Platform statistics' } },
        },
      },
      '/v1/openapi.json': {
        get: {
          summary: 'OpenAPI 3.0 specification',
          operationId: 'getOpenApiSpec',
          tags: ['System'],
          security: [],
          responses: { '200': { description: 'This specification document' } },
        },
      },
    },
    tags: [
      { name: 'Core', description: 'Orchestration, batch, and streaming endpoints' },
      { name: 'Account', description: 'Credits, balance, and API key management' },
      { name: 'Skills', description: 'Skill CRUD, invocation, and A/B testing' },
      { name: 'Marketplace', description: 'Skill marketplace browsing and purchases' },
      { name: 'Tasks', description: 'Async task submission and tracking' },
      { name: 'Discovery', description: 'Skill and endpoint discovery (semantic + registry)' },
      { name: 'Governance', description: 'On-platform proposals and weighted voting' },
      { name: 'Escrow', description: 'Credit-locked escrow for agent-to-agent work agreements' },
      { name: 'Swarm', description: 'Multi-agent decomposition and parallel task execution' },
      { name: 'LLM Proxy', description: 'OpenAI-compatible gateway to 23 models with credit billing' },
      { name: 'x402', description: 'Pay-per-call skill invocation via USDC micropayments on Base' },
      { name: 'Agent Context', description: 'Persistent per-agent data cache to avoid redundant API calls' },
      { name: 'Validators', description: 'Platform-native result verification and validator rewards' },
      { name: 'Economy', description: 'Agent sessions, transfers, delegation, and reputation' },
      { name: 'Admin', description: 'Admin-only operations (validator promotion, system management)' },
      { name: 'Manifest', description: 'Universal data verification, reasoning assessment, and decision memory' },
      { name: 'Attestation', description: 'Signed, tamper-proof proof of every agent action with public verification' },
      { name: 'Mesh', description: 'P2P mesh network peer discovery' },
      { name: 'System', description: 'Health, stats, and documentation' },
    ],
  };

  return c.json(spec);
});
