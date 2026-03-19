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
    description: 'Universal AI agent orchestration layer — 390+ API endpoints, skill marketplace, x402 payments',
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
      'attestation',
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
      x402Invoke: 'POST /x402/skills/:id',
      x402Orchestrate: 'POST /x402/orchestrate',
      x402Query: 'POST /x402/query/:id',
      x402Verify: 'GET /x402/verify/:requestId',
      discovery: 'GET /v1/discover',
      mcp: 'GET /.well-known/mcp.json',
      openapi: 'GET /v1/openapi.json',
      llmsTxt: 'GET /llms.txt',
      manifest: 'POST /v1/manifest',
      attest: 'POST /v1/attest',
      attestVerify: 'GET /v1/attest/verify/:id',
    },
    pricing: {
      model: 'credits',
      rate: '1 credit = $0.001 USD',
      x402Rate: `${env.X402_USDC_PER_CREDIT} USDC per credit`,
      cacheDiscount: '90% (cache hits cost 10% of live)',
    },
    integrations: {
      langchain: '@clawnet/langchain (npm)',
      agentkit: '@clawnet/agentkit (npm)',
      mcp: '@clawnet/mcp (npm)',
    },
    manifest: {
      endpoint: '/v1/manifest',
      description: 'Universal data verification, reasoning assessment, action pre-flight, and decision memory',
      pricing: { quick: 0.5, standard: 2.0, deep: 5.0 },
      currency: 'credits',
    },
    attestation: {
      endpoint: '/v1/attest',
      verify: '/v1/attest/verify/:id',
      description: 'Signed, verifiable proof of every agent action',
      pricing: { automatic: 'free', explicit: 0.25 },
    },
    trust: {
      signedResponses: !!env.PLATFORM_SIGNING_SECRET,
      cryptographicReceipts: true,
      slaContracts: true,
      validatorNetwork: true,
      x402Idempotency: true,
      facilitatorReceipts: true,
      trustChain: 'Payment proof (Coinbase facilitator) + Delivery proof (ClawNet attestation)',
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
        description: 'Natural language → multi-step API orchestration with 390+ endpoints',
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
        description: 'Pay-per-call skill invocation via USDC on Base — idempotent, with facilitator receipts',
        endpoint: '/x402/skills',
        methods: ['GET', 'POST'],
        auth: 'x402 (wallet-based)',
      },
      {
        name: 'Manifest',
        description: 'Universal data verification — verify claims, assess reasoning, pre-flight actions, remember decisions',
        endpoint: '/v1/manifest',
        methods: ['POST'],
        auth: 'X-API-Key',
      },
      {
        name: 'Attestation',
        description: 'Signed proof of every agent action — public verification endpoint',
        endpoint: '/v1/attest',
        methods: ['POST', 'GET'],
        auth: 'X-API-Key (create) or none (verify)',
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
        args: ['-y', '@clawnet/mcp'],
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
      discovery: 'GET /x402',
      listSkills: 'GET /x402/skills',
      invokeSkill: 'POST /x402/skills/:id',
      orchestrate: 'POST /x402/orchestrate',
      queryDataSkill: 'POST /x402/query/:id',
      verifyReceipt: 'GET /x402/verify/:requestId',
      reputation: 'GET /x402/reputation/:agentKey',
      testInvoke: 'POST /x402/test/skills/:id',
      testOrchestrate: 'POST /x402/test/orchestrate',
    },
    features: {
      idempotency: 'SHA-256 hash of X-PAYMENT header prevents double-execution on retries',
      facilitatorReceipt: 'Coinbase facilitator-signed payment proof stored per transaction',
      attestationLink: 'Each x402 receipt links to a ClawNet attestation (delivery proof)',
      trustChain: 'GET /x402/verify/:requestId returns both payment proof and delivery proof',
    },
    pricePerCredit: env.X402_USDC_PER_CREDIT,
    discoverable: true,
    bazaar: {
      registered: true,
      description: 'ClawNet AI Orchestration — 390+ API endpoints, skill marketplace, composite skills',
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
