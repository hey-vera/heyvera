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
    openapi: '3.0.3',
    info: {
      title: 'ClawNet Orchestrator API',
      description: 'Universal AI agent orchestration layer for Solana/Web3 intelligence. Send natural-language queries, receive structured answers powered by 160+ specialized API endpoints.',
      version: '2.0.0',
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
      // ── Mesh ────────────────────────────────────────────────────────
      '/v1/mesh/peers': {
        get: {
          summary: 'List mesh network peers',
          operationId: 'getMeshPeers',
          tags: ['Mesh'],
          security: [],
          responses: { '200': { description: 'Connected peers and node info' } },
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
      { name: 'Mesh', description: 'P2P mesh network peer discovery' },
      { name: 'System', description: 'Health, stats, and documentation' },
    ],
  };

  return c.json(spec);
});
