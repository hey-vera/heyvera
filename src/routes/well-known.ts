/**
 * .well-known discovery routes — cross-platform interoperability
 *
 * Serves agent-card.json, agents.json, mcp.json, x402.json, and did.json
 * for automated discovery by other AI agents and platforms.
 */
import { Hono } from 'hono';
import { env } from '../config/index';
import { apiRegistry } from '../config/api-registry';
import { getEd25519PublicKeyMultibase, getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { getHeartSafe } from '../core/soma';

const router = new Hono();

// ── GET /agent-card.json — ClawNet identity card ─────────────────────────
router.get('/agent-card.json', (c) => {
  return c.json({
    name: 'ClawNet',
    description: `Universal AI agent orchestration layer — ${apiRegistry.length}+ API endpoints, skill marketplace, x402 payments`,
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
        description: `Natural language → multi-step API orchestration with ${apiRegistry.length}+ endpoints`,
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
      description: `AI agent orchestration with ${apiRegistry.length}+ live APIs, skill marketplace, and cryptographic receipts`,
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
        description: `AI orchestration across ${apiRegistry.length}+ APIs`,
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
      description: `ClawNet AI Orchestration — ${apiRegistry.length}+ API endpoints, skill marketplace, composite skills`,
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

// ── GET /x402 — x402scan-compatible discovery (no .json extension) ──────────
// x402scan expects: GET /.well-known/x402 → { version: 1, resources: [...] }
// See: https://github.com/Merit-Systems/x402scan/blob/main/docs/DISCOVERY.md
router.get('/x402', (c) => {
  const base = env.CLAWNET_BASE_URL || 'https://api.claw-net.org';
  return c.json({
    version: 1,
    resources: [
      `${base}/x402/orchestrate`,
      `${base}/x402/skills/price-oracle-data`,
      `${base}/x402/skills/trending-tokens-data`,
      `${base}/x402/skills/whale-tracker-data`,
      `${base}/x402/skills/defi-yield-data`,
      `${base}/x402/query/price-oracle-data`,
      `${base}/x402/query/trending-tokens-data`,
      `${base}/x402/query/whale-tracker-data`,
      `${base}/x402/query/defi-yield-data`,
    ],
    ownershipProofs: [],
    instructions: `ClawNet AI agent orchestration. ${apiRegistry.length}+ API endpoints, 4 data skills, Manifest verification, Attestation proofs. Pay per call with USDC via x402. Full docs: ${base}/.well-known/x402.json`,
  });
});

// ── GET /agent.json — A2A Agent Card (Google Agent-to-Agent protocol v0.3.0) ──
router.get('/agent.json', (c) => {
  return c.json({
    name: 'ClawNet',
    description: `AI agent orchestration with ${apiRegistry.length}+ live APIs, skill marketplace, and cryptographic receipts`,
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
        description: `Query ${apiRegistry.length}+ APIs via natural language with budget controls and strategy optimization`,
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
    description: `Universal AI agent orchestration layer — ${apiRegistry.length}+ API endpoints, skill marketplace, x402 payments`,
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

// ── GET /aid.json — AID Protocol Discovery ──────────────────────────────────
// Standard well-known endpoint for AID discovery. Any agent can check
// /.well-known/aid.json to know if a server participates in AID,
// what its DID is, and what trust requirements it has.
// Same pattern as /.well-known/agent-card.json (A2A) and UCP.
router.get('/aid.json', (c) => {
  return c.json({
    did: 'did:web:api.claw-net.org',
    trustEndpoint: '/v1/aid/:did/trust',
    verifyEndpoint: '/v1/aid/verify',
    feedbackEndpoint: '/v1/aid/:did/feedback',
    supportedSigningAlgorithms: ['Ed25519'],
    supportedHashAlgorithms: ['SHA-256'],
    specVersion: '1.0.0',
    minTrustScore: 0,
    minTrustVector: null,
    trustVectorSupported: true,
    erc8004: {
      chainId: 8453,
      agentId: 36118,
      registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    },
    packages: {
      trustCompute: '@aidprotocol/trust-compute',
      mcpTrust: '@aidprotocol/mcp-trust',
    },
    spec: 'https://github.com/aidprotocol/aid-spec',
  });
});

// ── GET /erc8004-registration.json — ERC-8004 v1 Registration File ──────────
// This is the agentURI file that the on-chain IdentityRegistry points to.
// Format: https://eips.ethereum.org/EIPS/eip-8004#registration-v1
router.get('/erc8004-registration.json', (c) => {
  return c.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'ClawNet',
    description: `The trust and commerce layer for AI agents. Skill marketplace, ${apiRegistry.length}+ API endpoints, Soma-verified execution, x402 micropayments. The only orchestrator that makes itself cryptographically verifiable.`,
    image: 'https://claw-net.org/favicon.svg',
    services: [
      { name: 'web', endpoint: 'https://claw-net.org/' },
      { name: 'api', endpoint: 'https://api.claw-net.org/' },
      { name: 'MCP', endpoint: 'https://api.claw-net.org/v1/mcp', version: '2025-06-18' },
      { name: 'A2A', endpoint: 'https://api.claw-net.org/.well-known/agent-card.json', version: '0.3.0' },
      { name: 'x402', endpoint: 'https://api.claw-net.org/v1/skills', version: '0.1.0' },
      { name: 'Soma', endpoint: 'https://api.claw-net.org/.well-known/soma.json', version: '1.0.0' },
    ],
    x402Support: true,
    active: true,
    registrations: [
      {
        agentId: 36119,
        agentRegistry: 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      },
    ],
    supportedTrust: ['behavioral-verification', 'data-provenance'],
    protocols: {
      soma: { version: '1.0.0', spec: 'https://github.com/1xmint/Soma', discovery: '/.well-known/soma.json' },
      x402: { supported: true, network: 'base', facilitator: 'https://facilitator.claw-net.org' },
    },
  });
});

// ── GET /aid-registration.json — ERC-8004 v1 Registration for AID Protocol ──
// Separate from ClawNet — AID is the open protocol, ClawNet is an implementation.
router.get('/aid-registration.json', (c) => {
  return c.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'AID Protocol',
    description: 'Agent Identity Document — the trust layer for agentic commerce. Scored, verifiable, portable trust for any agent communication layer. Transport-agnostic. Crypto-agile. Open source (Apache 2.0).',
    image: 'https://claw-net.org/aid-logo.png',
    services: [
      { name: 'web', endpoint: 'https://claw-net.org/protocol' },
      { name: 'npm', endpoint: 'https://www.npmjs.com/org/aidprotocol' },
      { name: 'spec', endpoint: 'https://claw-net.org/docs/aid-protocol-spec.md' },
    ],
    x402Support: false,
    active: true,
    registrations: [
      {
        agentId: 36118,
        agentRegistry: 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      },
    ],
    supportedTrust: ['reputation', 'validation'],
    packages: {
      'trust-compute': { npm: '@aidprotocol/trust-compute', version: '2.0.0', license: 'MIT' },
      'mcp-trust': { npm: '@aidprotocol/mcp-trust', version: '1.1.0', license: 'MIT' },
      'sdk': { npm: '@aidprotocol/sdk', version: '1.0.0', license: 'Apache-2.0' },
      'middleware': { npm: '@aidprotocol/middleware', version: '1.0.0', license: 'Apache-2.0' },
    },
    standards: {
      w3c: ['did:key', 'VC 2.0', 'Bitstring Status List'],
      ietf: ['RFC 9421 (HTTP Signatures)', 'RFC 8785 (JCS)'],
      nist: ['NCCoE comment submitted (AI Agent Standards Initiative)'],
      dif: ['TAAWG membership pending'],
    },
    referenceImplementation: {
      name: 'ClawNet',
      url: 'https://claw-net.org',
      endpoints: apiRegistry.length,
      trustEndpoint: 'https://api.claw-net.org/v1/aid/:did/trust',
    },
  });
});

// ── GET /did.json — W3C DID Document (did:web:api.claw-net.org) ───────────
//
// Deterministic Ed25519 keypair derived from PLATFORM_SIGNING_SECRET.
// The same secret always produces the same keypair, so the public key
// published here matches the key used to sign Verifiable Credentials
// in vc-envelope.ts (eddsa-jcs-2022 Data Integrity proofs).
//
// The publicKeyMultibase uses the Multikey ed25519-pub prefix (0xed 0x01)
// encoded as base58btc with a 'z' Multibase prefix.
// ──────────────────────────────────────────────────────────────────────────

const DID_ID = 'did:web:api.claw-net.org';

router.get('/did.json', (c) => {
  return c.json({
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/data-integrity/v2',
    ],
    id: DID_ID,
    verificationMethod: [{
      id: `${DID_ID}#key-1`,
      type: 'Multikey',
      controller: DID_ID,
      publicKeyMultibase: getEd25519PublicKeyMultibase(),
    }],
    assertionMethod: [`${DID_ID}#key-1`],
    authentication: [`${DID_ID}#key-1`],
    service: [
      {
        id: `${DID_ID}#attestation`,
        type: 'AttestationService',
        serviceEndpoint: 'https://api.claw-net.org/v1/attest',
      },
      {
        id: `${DID_ID}#manifest`,
        type: 'VerificationService',
        serviceEndpoint: 'https://api.claw-net.org/v1/manifest',
      },
    ],
  });
});

// ── GET /aid-platform-key — Platform Ed25519 public key in JWK format ───
//
// Used by A2A consumers and @aidprotocol/mcp-trust middleware to verify
// trustProof signatures in agent cards and heartbeat responses.
// Same key material as /did.json verificationMethod, different format.
// ──────────────────────────────────────────────────────────────────────────

router.get('/aid-platform-key', (c) => {
  const raw = getEd25519PublicKeyRaw();
  return c.json({
    kty: 'OKP',
    crv: 'Ed25519',
    x: raw.toString('base64url'),
    kid: `${DID_ID}#key-1`,
    use: 'sig',
    alg: 'EdDSA',
  });
});

// ── GET /soma.json — Soma Heart identity and provenance discovery ────────
router.get('/soma.json', (c) => {
  const heart = getHeartSafe();
  if (!heart) return c.json({ enabled: false });
  return c.json({
    enabled: true,
    protocol: 'soma',
    version: '1.0.0',
    did: {
      soma: heart.did,
      aid: 'did:web:api.claw-net.org',
    },
    genome: heart.genomeCommitment,
    heartbeat: {
      chainLength: heart.heartbeats.length,
      headHash: heart.heartbeats.head,
      alive: heart.isAlive,
    },
    publicKey: getEd25519PublicKeyRaw().toString('hex'),
  });
});

// ── GET /soma-registration.json — ERC-8004 v1 Registration for Soma Protocol ─
// Soma is the identity-as-execution verification protocol. Separate from ClawNet
// (which implements Soma) and AID (which Soma replaced). Soma proves agent identity
// through physics (temporal fingerprinting + per-token HMAC), not reputation.
router.get('/soma-registration.json', (c) => {
  const heart = getHeartSafe();
  return c.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Soma',
    description: 'Identity as Execution — cryptographic agent verification protocol. Temporal fingerprinting + per-token HMAC proves which model is running. 88.5% cloud accuracy, 8/8 attacks detected. Open source (MIT).',
    image: 'https://claw-net.org/soma-logo.png',
    services: [
      { name: 'spec', endpoint: 'https://github.com/1xmint/Soma' },
      { name: 'npm:heart', endpoint: 'https://www.npmjs.com/package/soma-heart' },
      { name: 'npm:sense', endpoint: 'https://www.npmjs.com/package/soma-sense' },
      { name: 'paper', endpoint: 'https://doi.org/10.5281/zenodo.19260081' },
      { name: 'discovery', endpoint: 'https://api.claw-net.org/.well-known/soma.json' },
    ],
    x402Support: false,
    active: true,
    registrations: [],  // Updated after on-chain registration with agentId
    packages: {
      'soma-heart': { npm: 'soma-heart', license: 'MIT', description: 'Agent-side execution runtime — credential vault, birth certificates, heartbeat chain, per-token HMAC' },
      'soma-sense': { npm: 'soma-sense', license: 'MIT', description: 'Observer-side verification — temporal/topology/vocabulary fingerprinting, phenotype atlas, behavioral verdicts' },
    },
    protocol: {
      version: '1.0.0',
      encryption: 'X25519 + XSalsa20-Poly1305',
      signing: 'Ed25519 (crypto-agile, post-quantum migration path)',
      verification: {
        senses: ['temporal (5x weight, 88.5%)', 'topology (2x weight)', 'vocabulary (1x weight)'],
        verdicts: ['GREEN', 'AMBER', 'RED', 'UNCANNY'],
        attacks: '8/8 detected (impersonation, replay, signal injection, timing manipulation, composite agent, seed prediction, slow drift, mutation abuse)',
      },
    },
    identity: {
      genomeDid: heart?.did ?? null,
      canonicalDid: 'did:web:api.claw-net.org',
      publicKey: heart ? getEd25519PublicKeyRaw().toString('hex') : null,
    },
    referenceImplementation: {
      name: 'ClawNet',
      url: 'https://claw-net.org',
      somaDiscovery: 'https://api.claw-net.org/.well-known/soma.json',
    },
  });
});

// ── GET /openapi.json — redirect to /v1/openapi.json ────────────────────
router.get('/openapi.json', (c) => c.redirect('/v1/openapi.json', 302));

export { router as wellKnownRouter };
