/**
 * OpenAPI 3.0 Spec — GET /v1/openapi.json
 * Auto-generated from the API registry. Enables SDK generation via openapi-generator.
 * No auth required — spec is public documentation.
 */
import { Hono } from 'hono';
import { apiRegistry } from '../config/api-registry';

export const openapiRouter = new Hono();

openapiRouter.get('/openapi.json', (c) => {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'ClawNet Orchestrator API',
      description: 'Universal AI agent orchestration layer for Solana/Web3 intelligence. Send natural-language queries, receive structured answers powered by 75+ specialized API endpoints.',
      version: '1.0.0',
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
      },
    },
    paths: {
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
                    query: {
                      type: 'string',
                      maxLength: 2000,
                      example: 'What is the price and risk score for SOL?',
                    },
                  },
                  required: ['query'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Successful orchestration',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OrchestrationResponse' },
                },
              },
            },
            '402': { description: 'Insufficient credits', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '429': { description: 'Rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/batch': {
        post: {
          summary: 'Batch orchestrate multiple queries',
          description: 'Run up to 10 independent queries in parallel. Billed per query. Returns all results in a single response.',
          operationId: 'batchOrchestrate',
          tags: ['Core'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    queries: {
                      type: 'array',
                      items: { type: 'string', maxLength: 2000 },
                      minItems: 1,
                      maxItems: 10,
                    },
                  },
                  required: ['queries'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Batch results',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/BatchResponse' } } },
            },
            '402': { description: 'Insufficient credits', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/stream/orchestrate': {
        get: {
          summary: 'Stream orchestration via SSE',
          description: 'Real-time Server-Sent Events stream. Emits `start`, `plan`, `step`, `done`, and `error` events as orchestration progresses.',
          operationId: 'streamOrchestrate',
          tags: ['Core'],
          parameters: [
            {
              name: 'query',
              in: 'query',
              required: true,
              schema: { type: 'string', maxLength: 2000 },
              description: 'Natural-language query to orchestrate',
            },
          ],
          responses: {
            '200': {
              description: 'SSE stream',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                  example: 'event: step\ndata: {"index":0,"endpointId":"claw-token-price","success":true}\n\n',
                },
              },
            },
          },
        },
      },
      '/v1/estimate': {
        get: {
          summary: 'Estimate credit cost for a query',
          description: 'Runs intent parsing only (no execution, no credit charge) and returns the estimated credits required. Use this to budget before calling /v1/orchestrate.',
          operationId: 'estimateQuery',
          tags: ['Core'],
          security: [],
          parameters: [
            {
              name: 'query',
              in: 'query',
              required: true,
              schema: { type: 'string', maxLength: 2000 },
              description: 'Natural language query to estimate cost for',
            },
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
                      estimatedCredits: { type: 'integer', description: 'Total credits this query would cost' },
                      steps: { type: 'integer', description: 'Number of API calls planned' },
                      summary: { type: 'string' },
                      breakdown: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            endpointId: { type: 'string' },
                            credits: { type: 'integer' },
                            reason: { type: 'string' },
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
      '/v1/balance': {
        get: {
          summary: 'Get credit balance',
          operationId: 'getBalance',
          tags: ['Account'],
          responses: {
            '200': {
              description: 'Current balance',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      credits: { type: 'integer' },
                      creditsUsed: { type: 'integer' },
                      memberSince: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/registry': {
        get: {
          summary: 'List available API endpoints',
          description: 'Returns all endpoints in the orchestration registry, grouped by category.',
          operationId: 'getRegistry',
          tags: ['Discovery'],
          security: [],
          responses: {
            '200': {
              description: 'Registry of available endpoints',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalEndpoints: { type: 'integer', example: apiRegistry.length },
                      categories: { type: 'object', additionalProperties: { type: 'array', items: { type: 'object' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health': {
        get: {
          summary: 'Health check',
          operationId: 'healthCheck',
          tags: ['System'],
          security: [],
          responses: {
            '200': { description: 'Service healthy' },
            '503': { description: 'Service degraded' },
          },
        },
      },
    },
    tags: [
      { name: 'Core', description: 'Orchestration endpoints' },
      { name: 'Account', description: 'Credits and API key management' },
      { name: 'Discovery', description: 'Skill and endpoint discovery' },
      { name: 'System', description: 'Health and status' },
    ],
  };

  return c.json(spec);
});
