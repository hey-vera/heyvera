/**
 * .well-known discovery routes — cross-platform interoperability
 *
 * Serves agent-card.json, agents.json, mcp.json, and x402.json
 * for automated discovery by other AI agents and platforms.
 */
import { Hono } from 'hono';
import { env } from '../config/index';

const router = new Hono();

// ── GET /agent-card.json — ClawNet identity card ─────────────────────────
router.get('/agent-card.json', (c) => {
  return c.json({
    name: 'ClawNet',
    description: 'Universal AI agent orchestration layer — 344+ API endpoints, skill marketplace, x402 payments',
    version: '1.0.0',
    url: env.CLAWNET_BASE_URL,
    capabilities: [
      'orchestration',
      'skill-marketplace',
      'x402-payments',
      'mcp-server',
      'batch-queries',
      'streaming',
      'escrow',
      'governance',
      'manifest',
    ],
    authentication: {
      apiKey: {
        header: 'X-API-Key',
        prefix: 'cn-',
        required: false,
        description: 'Required for paid operations. Not needed for x402 or public browsing.',
      },
      x402: {
        description: 'Pay-per-call with USDC on Base via x402 protocol. No account needed.',
        network: env.X402_NETWORK,
        recipient: env.X402_RECIPIENT_ADDRESS ?? null,
      },
      clerk: {
        header: 'Authorization',
        scheme: 'Bearer',
        description: 'Clerk JWT for user-specific endpoints',
      },
    },
    endpoints: {
      orchestrate: 'POST /v1/orchestrate',
      skills: 'GET /v1/marketplace/skills',
      invokeSkill: 'POST /v1/skills/:id/invoke',
      x402Skills: 'GET /x402/skills',
      discovery: 'GET /v1/discover',
      mcp: 'GET /.well-known/mcp.json',
      openapi: 'GET /v1/openapi.json',
      llmsTxt: 'GET /llms.txt',
    },
    pricing: {
      model: 'credits',
      rate: '1 credit = $0.001 USD',
      x402Rate: `${env.X402_USDC_PER_CREDIT} USDC per credit`,
      cacheDiscount: '90% (cache hits cost 10% of live)',
    },
    manifest: {
      endpoint: '/v1/manifest',
      description: 'Universal data verification, reasoning assessment, action pre-flight, and decision memory',
      pricing: { quick: 0.5, standard: 2.0, deep: 5.0 },
      currency: 'credits',
    },
    trust: {
      signedResponses: !!env.PLATFORM_SIGNING_SECRET,
      cryptographicReceipts: true,
      slaContracts: true,
      validatorNetwork: true,
    },
    contact: {
      website: 'https://claw-net.org',
      twitter: 'https://x.com/clawnet',
    },
  });
});

// ── GET /agents.json — agent service listing ─────────────────────────────
router.get('/agents.json', (c) => {
  return c.json({
    agents: [
      {
        name: 'ClawNet Orchestrator',
        description: 'Natural language → multi-step API orchestration with 344+ endpoints',
        endpoint: '/v1/orchestrate',
        methods: ['POST'],
        auth: 'X-API-Key or x402',
      },
      {
        name: 'Skill Marketplace',
        description: 'Browse, invoke, and compose AI skills',
        endpoint: '/v1/marketplace/skills',
        methods: ['GET'],
        auth: 'none (public browsing)',
      },
      {
        name: 'x402 Provider',
        description: 'Pay-per-call skill invocation via USDC on Base',
        endpoint: '/x402/skills',
        methods: ['GET', 'POST'],
        auth: 'x402 (wallet-based)',
      },
    ],
  });
});

// ── GET /mcp.json — MCP server discovery ─────────────────────────────────
router.get('/mcp.json', (c) => {
  return c.json({
    name: 'ClawNet MCP Server',
    version: '1.0.0',
    description: 'MCP tools for ClawNet skill marketplace and orchestration',
    servers: [
      {
        name: 'clawnet-stdio',
        transport: 'stdio',
        command: 'npx',
        args: ['tsx', 'src/mcp/server.ts'],
        env: {
          CLAWNET_BASE_URL: env.CLAWNET_BASE_URL,
          CLAWNET_API_KEY: 'YOUR_API_KEY',
        },
        tools: ['list-skills', 'get-skill', 'invoke-skill', 'search-registry', 'orchestrate', 'get-credits'],
      },
      {
        name: 'clawnet-http',
        transport: 'streamable-http',
        url: `${env.CLAWNET_BASE_URL}/mcp`,
        description: 'Remote HTTP MCP server (streamable-http transport)',
        tools: ['list-skills', 'get-skill', 'invoke-skill', 'search-registry', 'orchestrate', 'get-credits'],
      },
      {
        name: 'clawnet-x402',
        transport: 'streamable-http',
        url: `${env.CLAWNET_BASE_URL}/mcp/x402`,
        description: 'x402 payment-gated MCP server — pay per tool call with USDC on Base',
        auth: 'x402 (USDC on Base — no API key needed)',
        tools: ['list-skills', 'get-skill', 'invoke-skill', 'search-registry', 'orchestrate', 'get-credits'],
      },
    ],
    resources: [],
    prompts: [],
  });
});

// ── GET /x402.json — x402 payment discovery ──────────────────────────────
router.get('/x402.json', (c) => {
  if (!env.X402_RECIPIENT_ADDRESS) {
    return c.json({ enabled: false, hint: 'x402 provider mode not configured' });
  }

  const chainId = env.X402_NETWORK === 'base-sepolia' ? '84532' : '8453';

  return c.json({
    version: '2.0',
    provider: 'ClawNet',
    network: env.X402_NETWORK,
    chainId,
    currency: 'USDC',
    recipientAddress: env.X402_RECIPIENT_ADDRESS,
    facilitator: env.X402_FACILITATOR_URL,
    endpoints: {
      discovery: '/x402',
      listSkills: '/x402/skills',
      invokeSkill: '/x402/skills/:id',
      verifyReceipt: '/x402/verify/:requestId',
    },
    pricePerCredit: env.X402_USDC_PER_CREDIT,
    discoverable: true,
    bazaar: {
      registered: true,
      description: 'ClawNet AI Orchestration — 344+ API endpoints, skill marketplace, composite skills',
      categories: ['orchestration', 'ai-ml', 'defi', 'social', 'search', 'security', 'infrastructure'],
      capabilities: ['skill-invocation', 'natural-language-orchestration', 'data-queries', 'composite-workflows'],
      pricing: {
        model: 'per-call',
        currency: 'USDC',
        range: { min: env.X402_USDC_PER_CREDIT, max: env.X402_USDC_PER_CREDIT * 10000 },
      },
    },
  });
});

// ── GET /agent-registration.json — agent onboarding discovery ────────────
router.get('/agent-registration.json', (c) => {
  return c.json({
    name: 'ClawNet',
    version: '1.0.0',
    registration: {
      endpoint: '/v1/onboard/register',
      method: 'POST',
      description: 'Register as a ClawNet agent. Returns an API key for authenticated operations.',
      fields: {
        name: { type: 'string', required: true, description: 'Agent or project name' },
        email: { type: 'string', required: false, description: 'Contact email (optional)' },
      },
    },
    alternativeAccess: {
      x402: {
        description: 'No registration needed. Pay per call with USDC on Base.',
        endpoint: '/x402/skills',
      },
      mcp: {
        description: 'Connect via MCP. No API key needed for browsing.',
        endpoint: '/mcp',
      },
    },
  });
});

// ── GET /openapi.json — redirect to /v1/openapi.json ────────────────────
router.get('/openapi.json', (c) => c.redirect('/v1/openapi.json', 302));

export { router as wellKnownRouter };
