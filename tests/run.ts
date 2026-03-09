const BASE_URL = 'http://localhost:3402';
const API_KEY = process.env.API_KEYS?.split(',')[0] ?? '';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

interface OrchestrationResponse {
  requestId: string;
  answer: string;
  suggestedActions?: string[];
  costBreakdown?: Record<string, number>;
  metadata?: {
    stepsExecuted: number;
    cacheHits: number;
    totalDurationMs: number;
    llmProvider: string;
    simulationMode: boolean;
  };
  route?: Record<string, unknown>;
  code?: string;
  error?: string;
}

interface HealthResponse {
  status: string;
  uptime: number;
  endpoints: number;
  cache: Record<string, unknown>;
}

interface RegistryResponse {
  totalEndpoints: number;
  categories: Record<string, unknown[]>;
}

async function post(path: string, body: unknown): Promise<OrchestrationResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...(API_KEY && { 'X-API-Key': API_KEY }),
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<OrchestrationResponse>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  return res.json() as Promise<T>;
}

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, durationMs: Date.now() - start };
  } catch (err) {
    return { name, passed: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start };
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log('🧪 Running Phase 1 tests...\n');
  const results: TestResult[] = [];

  results.push(await runTest('GET /v1/health returns ok', async () => {
    const data = await get<HealthResponse>('/v1/health');
    assert(data.status === 'ok', `status should be ok, got ${data.status}`);
    assert(typeof data.uptime === 'number', 'uptime should be a number');
    assert(data.endpoints >= 15, `should have at least 15 endpoints, got ${data.endpoints}`);
  }));

  results.push(await runTest('GET /v1/registry returns endpoints', async () => {
    const data = await get<RegistryResponse>('/v1/registry');
    assert(data.totalEndpoints >= 15, `should have at least 15 endpoints, got ${data.totalEndpoints}`);
    assert(Object.keys(data.categories).length >= 3, 'should have at least 3 categories');
  }));

  results.push(await runTest('Single endpoint: token price query', async () => {
    const data = await post('/v1/orchestrate', { query: 'What is the price of BONK token?' });
    assert(typeof data.answer === 'string', 'answer should be a string');
    assert(data.answer.length > 10, 'answer should have content');
    assert(typeof data.costBreakdown === 'object', 'costBreakdown should exist');
    assert(typeof data.requestId === 'string', 'requestId should exist');
    assert((data.metadata?.stepsExecuted ?? 0) >= 1, 'should have executed at least 1 step');
  }));

  results.push(await runTest('Multi-step: BONK full analysis', async () => {
    const data = await post('/v1/orchestrate', { query: 'Analyze BONK token: price, holders, risk score, and X sentiment' });
    assert(typeof data.answer === 'string', 'answer should be a string');
    assert((data.metadata?.stepsExecuted ?? 0) >= 2, `should execute at least 2 steps, got ${data.metadata?.stepsExecuted}`);
    assert(typeof data.route === 'object', 'route should exist');
  }));

  results.push(await runTest('Cache: repeat query gets cache hit', async () => {
    await post('/v1/orchestrate', { query: 'What is the price of BONK token?' });
    const data = await post('/v1/orchestrate', { query: 'What is the price of BONK token?' });
    assert((data.metadata?.cacheHits ?? 0) >= 1, `second request should have cache hits, got ${data.metadata?.cacheHits}`);
  }));

  results.push(await runTest('Error handling: missing query returns error', async () => {
    const res = await fetch(`${BASE_URL}/v1/orchestrate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(API_KEY && { 'X-API-Key': API_KEY }),
      },
      body: JSON.stringify({}),
    });
    const data = await res.json() as OrchestrationResponse;
    assert(data.code === 'MISSING_QUERY', `should return MISSING_QUERY, got ${data.code}`);
  }));

  console.log('Results:');
  let passed = 0;
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name} (${r.durationMs}ms)`);
    if (!r.passed) console.log(`   Error: ${r.error}`);
    if (r.passed) passed++;
  }

  console.log(`\n${passed}/${results.length} tests passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});