const BASE_URL = 'http://localhost:3402';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  return res.json();
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

  // Test 1: Health check
  results.push(await runTest('GET /v1/health returns ok', async () => {
    const data = await get('/v1/health') as Record<string, unknown>;
    assert(data.status === 'ok', `status should be ok, got ${data.status}`);
    assert(typeof data.uptime === 'number', 'uptime should be a number');
    assert(data.endpoints === 15, `should have 15 endpoints, got ${data.endpoints}`);
  }));

  // Test 2: Registry
  results.push(await runTest('GET /v1/registry returns 15 endpoints', async () => {
    const data = await get('/v1/registry') as Record<string, unknown>;
    assert(data.totalEndpoints === 15, `should have 15 endpoints, got ${data.totalEndpoints}`);
    const cats = data.categories as Record<string, unknown[]>;
    assert(Object.keys(cats).length >= 3, 'should have at least 3 categories');
  }));

  // Test 3: Single endpoint query
  results.push(await runTest('Single endpoint: token price query', async () => {
    const data = await post('/v1/orchestrate', { query: 'What is the price of BONK token?' }) as Record<string, unknown>;
    assert(typeof data.answer === 'string', 'answer should be a string');
    assert(data.answer.length > 10, 'answer should have content');
    assert(typeof data.costBreakdown === 'object', 'costBreakdown should exist');
    assert(typeof data.requestId === 'string', 'requestId should exist');
    const meta = data.metadata as Record<string, unknown>;
    assert(meta.stepsExecuted >= 1, 'should have executed at least 1 step');
  }));

  // Test 4: Multi-step query
  results.push(await runTest('Multi-step: BONK full analysis', async () => {
    const data = await post('/v1/orchestrate', { query: 'Analyze BONK token: price, holders, risk score, and X sentiment' }) as Record<string, unknown>;
    assert(typeof data.answer === 'string', 'answer should be a string');
    const meta = data.metadata as Record<string, unknown>;
    assert(meta.stepsExecuted >= 2, `should execute at least 2 steps, got ${meta.stepsExecuted}`);
    assert(typeof data.route === 'object', 'route should exist');
  }));

  // Test 5: Cache hit on repeat query
  results.push(await runTest('Cache: repeat query gets cache hit', async () => {
    await post('/v1/orchestrate', { query: 'What is the price of BONK token?' });
    const data = await post('/v1/orchestrate', { query: 'What is the price of BONK token?' }) as Record<string, unknown>;
    const meta = data.metadata as Record<string, unknown>;
    assert(meta.cacheHits >= 1, `second request should have cache hits, got ${meta.cacheHits}`);
  }));

  // Test 6: Missing query returns 400
  results.push(await runTest('Error handling: missing query returns error', async () => {
    const data = await post('/v1/orchestrate', {}) as Record<string, unknown>;
    assert(data.code === 'MISSING_QUERY', `should return MISSING_QUERY, got ${data.code}`);
  }));

  // Print results
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