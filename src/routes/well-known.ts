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
      siwx: {
        type: 'wallet-signature',
        description: 'Zero-key onboarding — sign a challenge with any supported wallet to get a session and API key. Supports Solana (Phantom) and EVM chains.',
        endpoint: '/v1/auth/siwx',
        nonceEndpoint: '/v1/auth/siwx/nonce',
        chainsEndpoint: '/v1/auth/siwx/chains',
        supportedChains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'eip155:8453', 'eip155:1', 'eip155:10', 'eip155:42161'],
        standard: 'CAIP-122',
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

// ── Per-tool USDC pricing for MCP discovery ──────────────────────────────
const mcpToolsWithPricing = [
  {
    name: 'list-skills',
    description: 'Browse the ClawNet skill marketplace',
    pricing: { model: 'per_call', creditCost: 0, estimatedUsdCost: 0, currency: 'USDC', note: 'Free — read-only' },
  },
  {
    name: 'get-skill',
    description: 'Get full details about a skill',
    pricing: { model: 'per_call', creditCost: 0, estimatedUsdCost: 0, currency: 'USDC', note: 'Free — read-only' },
  },
  {
    name: 'invoke-skill',
    description: 'Execute a skill with provided variables',
    pricing: { model: 'per_call', creditCost: null, estimatedUsdCost: null, currency: 'USDC', note: 'Varies by skill (0.1-50 credits, $0.0001-$0.05 USDC)' },
  },
  {
    name: 'search-registry',
    description: 'Search the API endpoint registry',
    pricing: { model: 'per_call', creditCost: 0, estimatedUsdCost: 0, currency: 'USDC', note: 'Free — read-only' },
  },
  {
    name: 'orchestrate',
    description: 'AI orchestration — multi-step API workflows',
    pricing: { model: 'per_call', creditCost: 2, estimatedUsdCost: 0.002, currency: 'USDC', note: 'Base fee + variable API costs' },
  },
  {
    name: 'get-credits',
    description: 'Check your credit balance',
    pricing: { model: 'per_call', creditCost: 0, estimatedUsdCost: 0, currency: 'USDC', note: 'Free — read-only' },
  },
];

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
        tools: mcpToolsWithPricing,
      },
      {
        name: 'clawnet-http',
        transport: 'streamable-http',
        url: `${env.CLAWNET_BASE_URL}/mcp`,
        description: 'Remote HTTP MCP server (streamable-http transport)',
        tools: mcpToolsWithPricing,
      },
      {
        name: 'clawnet-x402',
        transport: 'streamable-http',
        url: `${env.CLAWNET_BASE_URL}/mcp/x402`,
        description: 'x402 payment-gated MCP server — pay per tool call with USDC on Base',
        auth: 'x402 (USDC on Base — no API key needed)',
        tools: mcpToolsWithPricing,
      },
    ],
    resources: [],
    prompts: [],
  });
});

// ── GET /x402.json — x402 v2 Discovery extension ─────────────────────────
router.get('/x402.json', (c) => {
  if (!env.X402_RECIPIENT_ADDRESS) {
    return c.json({ enabled: false, hint: 'x402 provider mode not configured' });
  }

  const isTestnet = env.X402_NETWORK === 'base-sepolia';
  const baseChainId = isTestnet ? 'eip155:84532' : 'eip155:8453';
  const baseChainName = isTestnet ? 'Base Sepolia' : 'Base Mainnet';

  return c.json({
    // ── v2 Discovery extension fields ──────────────────────────────────
    x402Version: 2,
    provider: {
      name: 'ClawNet',
      description: 'AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts',
      url: 'https://claw-net.org',
      contact: 'team@claw-net.org',
      logo: 'https://claw-net.org/assets/logo.png',
    },
    capabilities: [
      'orchestration',
      'skill-marketplace',
      'attestation',
      'manifest',
      'mcp',
      'a2a',
    ],
    networks: [
      {
        chainId: baseChainId,
        name: baseChainName,
        assets: ['USDC'],
        facilitators: [
          {
            url: env.X402_FACILITATOR_URL,
            name: 'Coinbase CDP',
            primary: true,
          },
          ...(env.X402_FACILITATOR_FALLBACK_URL
            ? [{
                url: env.X402_FACILITATOR_FALLBACK_URL,
                name: 'Fallback Facilitator',
                primary: false,
              }]
            : []),
        ],
      },
      {
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        name: 'Solana Mainnet',
        assets: ['USDC'],
        facilitators: [],
      },
    ],
    endpoints: [
      {
        path: '/x402/skills/:skillId',
        method: 'POST',
        description: 'Invoke a marketplace skill via x402 payment',
        pricing: { model: 'per_call', currency: 'USDC' },
      },
      {
        path: '/x402/orchestrate',
        method: 'POST',
        description: 'AI orchestration across 390+ APIs',
        pricing: { model: 'per_call', estimatedUsd: 0.002, currency: 'USDC' },
      },
      {
        path: '/x402/offer/:skillId',
        method: 'GET',
        description: 'Pre-fetch x402 offer for a skill (no payment required)',
      },
      {
        path: '/x402/query/:id',
        method: 'POST',
        description: 'Query a data skill via x402 payment',
        pricing: { model: 'per_call', currency: 'USDC' },
      },
      {
        path: '/x402/verify/:requestId',
        method: 'GET',
        description: 'Verify x402 payment and delivery receipts (no payment required)',
      },
    ],
    discovery: {
      agentCard: '/.well-known/agent.json',
      mcp: '/.well-known/mcp.json',
      openapi: '/v1/openapi.json',
      a2a: '/.well-known/agent.json',
      erc8004: '/v1/erc8004/catalog',
      healthCheck: '/v1/stats/health/skills',
      liveness: '/health/live',
    },
    authentication: [
      { type: 'x402', description: 'Pay-per-call via x402 protocol' },
      { type: 'api_key', header: 'X-API-Key', prefix: 'cn-' },
      { type: 'siwx', description: 'Wallet signature auth — sign a challenge, get a session. Supports Solana + EVM.', endpoint: '/v1/auth/siwx', standard: 'CAIP-122' },
      { type: 'bearer', description: 'Clerk JWT for dashboard endpoints' },
    ],

    // ── Legacy fields (preserved for backward compatibility) ───────────
    version: '2.0',
    network: env.X402_NETWORK,
    chainId: isTestnet ? '84532' : '8453',
    currency: 'USDC',
    recipientAddress: env.X402_RECIPIENT_ADDRESS,
    facilitator: env.X402_FACILITATOR_URL,
    legacyEndpoints: {
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
      idempotency: 'SHA-256 hash of X-PAYMENT / PAYMENT-SIGNATURE header prevents double-execution on retries',
      headerVersions: 'Accepts both x402 v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE, PAYMENT-REQUIRED, PAYMENT-RESPONSE) headers',
      facilitatorReceipt: 'Coinbase facilitator-signed payment proof stored per transaction',
      attestationLink: 'Each x402 receipt links to a ClawNet attestation (delivery proof)',
      trustChain: 'GET /x402/verify/:requestId returns both payment proof and delivery proof',
    },
    healthCheck: {
      url: `${env.CLAWNET_BASE_URL}/v1/stats/health/skills`,
      liveness: `${env.CLAWNET_BASE_URL}/health/live`,
      intervalMinutes: 15,
    },
    pricePerCredit: env.X402_USDC_PER_CREDIT,
    supportedNetworks: [env.X402_NETWORK],
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

// ── GET /agent.json — A2A Agent Card (Google Agent-to-Agent protocol v0.3.0) ──
router.get('/agent.json', (c) => {
  return c.json({
    name: 'ClawNet',
    description: 'AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts',
    url: env.CLAWNET_BASE_URL,
    version: '1.0.0',
    protocolVersion: '0.3.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: [
      {
        id: 'orchestrate',
        name: 'AI Orchestration',
        description: 'Query 390+ APIs via natural language with budget controls and strategy optimization',
        tags: ['orchestration', 'api', 'ai', 'multi-provider'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'invoke-skill',
        name: 'Skill Invocation',
        description: 'Invoke marketplace skills by ID with template variables',
        tags: ['skills', 'marketplace', 'data'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'verify',
        name: 'Manifest Verification',
        description: 'Verify data integrity and trust scoring before agent actions',
        tags: ['verification', 'trust', 'manifest'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'attest',
        name: 'Attestation',
        description: 'Cryptographic proof of agent actions with HMAC-SHA256 signatures',
        tags: ['attestation', 'proof', 'cryptographic'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
    authentication: {
      schemes: ['apiKey', 'siwx', 'bearer'],
      credentials: null,
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
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

// ── GET /erc8004.json — ERC-8004 platform-level agent card ──────────────
router.get('/erc8004.json', (c) => {
  return c.json({
    schemaVersion: '1.0.0',
    agentId: 'clawnet-platform',
    name: 'ClawNet',
    description: 'Universal AI agent orchestration layer — 390+ API endpoints, skill marketplace, x402 payments',
    url: env.CLAWNET_BASE_URL,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: {
      schemes: [
        { scheme: 'apiKey', header: 'X-API-Key', format: 'cn-*' },
        { scheme: 'siwx', endpoint: '/v1/auth/siwx', standard: 'CAIP-122', description: 'Wallet signature auth — Solana + EVM' },
        { scheme: 'x402', network: env.X402_NETWORK },
        { scheme: 'bearer', header: 'Authorization', description: 'Clerk JWT' },
      ],
    },
    skills: [],
    skillCatalog: `${env.CLAWNET_BASE_URL}/v1/erc8004/catalog`,
    endpoints: {
      catalog: '/v1/erc8004/catalog',
      skillCard: '/v1/skills/:id/erc8004',
      orchestrate: '/v1/orchestrate',
      invoke: '/v1/skills/:id/invoke',
      marketplace: '/v1/marketplace/skills',
    },
    reputation: {
      totalInvocations: null,
      avgRating: null,
      successRate: null,
      verified: true,
    },
    provider: {
      name: 'ClawNet',
      url: 'https://claw-net.org',
      contact: 'team@claw-net.org',
    },
  });
});

// ── GET /openapi.json — redirect to /v1/openapi.json ────────────────────
router.get('/openapi.json', (c) => c.redirect('/v1/openapi.json', 302));

export { router as wellKnownRouter };
