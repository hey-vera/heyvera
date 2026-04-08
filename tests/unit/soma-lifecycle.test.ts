/**
 * End-to-end Soma lifecycle integration test
 *
 * Simulates ClawAPIs (first external customer) going through the full flow:
 *
 *   1. Provider registers with API key
 *   2. Provider endpoint seeded in registry
 *   3. Agent makes direct call → credits deducted, Pulse Tree ACTION leaf appended
 *   4. Agent makes second call with If-Soma-Hash → Soma Check hit (shadow = free)
 *   5. Trust Oracle query → returns score reflecting activity from Pulse Tree
 *   6. Vouch graph → agent stakes trust, social dimension changes
 *   7. Credit metering verified at every step
 *
 * This is the "make it real" pass — if ClawAPIs can't go through this flow,
 * we're not production-ready.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  createTestApp,
  callEndpoint,
  mockX402Call,
  mockBirthCert,
  validApiKey,
} from './helpers/integration';

import { initDb, getApiKeyBalance } from '../../src/db/index';
import { createProvider, setApiKeyProvider, getEndpointProvider } from '../../src/db/providers';
import { resolveAgentDid, getAgentPulseState, getRecentLeaves } from '../../src/core/soma-heartbeat';
import { queryTrust, TRUST_QUERY_COSTS } from '../../src/core/trust-oracle';
import { stakeVouch, getVouchScore } from '../../src/core/vouch-graph';
import { deductCredit } from '../../src/db/credits';
import { getDb } from '../../src/db/connection';
import { PULSE_TYPE } from '../../src/core/pulse-tree';

let app: Awaited<ReturnType<typeof createTestApp>>;

// Shared state across the lifecycle tests
let agentApiKey: string;
let agentDid: string;
let providerApiKey: string;
let providerId: string;
const ENDPOINT_ID = 'claw-token-price'; // exists in static registry

beforeAll(async () => {
  initDb();
  app = await createTestApp();
});

beforeEach(() => {
  // Clean slate for each test run
  const db = getTestDb();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM providers').run();
  db.prepare('DELETE FROM pulse_tree_leaves').run();
  db.prepare('DELETE FROM agent_pulse_state').run();
  db.prepare('DELETE FROM trust_queries').run();
  db.prepare('DELETE FROM vouch_stakes').run();
  db.prepare('DELETE FROM soma_check_events').run();
  db.prepare('DELETE FROM provider_endpoints').run();
  db.prepare('DELETE FROM provider_analytics').run();
  db.prepare('DELETE FROM cache_certificates').run();

  // Seed the agent (consumer) and provider (ClawAPIs)
  const agent = seedApiKey(db, { key: validApiKey(), credits: 500 });
  agentApiKey = agent.key;
  agentDid = resolveAgentDid(agentApiKey);

  const provSeed = seedApiKey(db, { key: validApiKey(), credits: 100 });
  providerApiKey = provSeed.key;

  // Create ClawAPIs provider, activate, and link its key
  const provider = createProvider({
    name: 'ClawAPIs',
    slug: 'clawapis',
    email: 'api@clawapis.com',
  });
  providerId = provider.id;
  // Activate the provider (revenue share requires active status)
  db.prepare("UPDATE providers SET status = 'active' WHERE id = ?").run(providerId);
  setApiKeyProvider(providerApiKey, providerId);

  // Link the test endpoint to this provider via provider_endpoints (what getEndpointProvider reads)
  db.prepare('INSERT OR REPLACE INTO provider_endpoints (provider_id, endpoint_id) VALUES (?, ?)').run(providerId, ENDPOINT_ID);

  // Reset mock state
  mockX402Call({ price: 42.5, symbol: 'SOL' });
  mockBirthCert(null);
});

// ─── Full Lifecycle ────────────────────────────────────────────────────────

describe('Soma lifecycle — ClawAPIs as first customer', () => {

  // ─── Step 1: Provider exists and endpoint is linked ───────────────────────

  it('provider is registered with endpoint linked', () => {
    const epProvider = getEndpointProvider(ENDPOINT_ID);
    expect(epProvider).toBe(providerId);
  });

  // ─── Step 2: Direct API call → Pulse Tree leaf ───────────────────────────

  it('direct call appends ACTION leaf to Pulse Tree', async () => {
    const balBefore = getApiKeyBalance(agentApiKey)!.credits;

    const res = await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.dataHash).toBeTruthy();
    expect(body.protocol).toBe('soma-check');

    // Credits deducted
    const balAfter = getApiKeyBalance(agentApiKey)!.credits;
    expect(balAfter).toBeLessThan(balBefore);

    // Pulse Tree leaf should exist for this agent
    const state = getAgentPulseState(agentDid);
    expect(state).not.toBeNull();
    expect(state!.heartbeatIndex).toBeGreaterThanOrEqual(1);
    expect(state!.leafCount).toBeGreaterThanOrEqual(1);

    // Leaf should be an ACTION type (PULSE_TYPE.ACTION = 0x01)
    const leaves = getRecentLeaves(agentDid, 5);
    expect(leaves.length).toBeGreaterThanOrEqual(1);
    const actionLeaf = leaves.find(l => l.type === PULSE_TYPE.ACTION);
    expect(actionLeaf).toBeTruthy();
  });

  // ─── Step 3: Soma Check hash match → skip payment (shadow) ───────────────

  // ─── Step 3: Soma Check saves money vs full call ──────────────────────────
  // v163 killed shadow tier — all providers are Tier 1+ (active billing).
  // Soma Check charges ~10% of origin price, saving the agent 90%.

  it('Soma Check returns unchanged=true and charges ~10% of origin', async () => {
    // Prime the cache with first call
    const res1 = await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'soma-lifecycle-test' },
    });
    const body1 = await res1.json();
    expect(body1.dataHash).toBeTruthy();
    const fullCallCost = body1.creditsUsed;

    const creditsBefore = getApiKeyBalance(agentApiKey)!.credits;

    // Second call with If-Soma-Hash — data unchanged, should pay ~10%
    const res2 = await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'soma-lifecycle-test' },
      ifSomaHash: body1.dataHash,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Soma Check hit: unchanged + hash echoed + protocol tag + tier 1
    expect(body2.unchanged).toBe(true);
    expect(body2.dataHash).toBe(body1.dataHash);
    expect(body2.protocol).toBe('soma-check');
    expect(body2.somaTier).toBeGreaterThanOrEqual(1);

    // Billed: hit price > 0 but much less than a full call
    expect(body2.creditsUsed).toBeGreaterThan(0);
    expect(body2.creditsUsed).toBeLessThan(fullCallCost);

    // Agent credits deducted
    const creditsAfter = getApiKeyBalance(agentApiKey)!.credits;
    expect(creditsAfter).toBeLessThan(creditsBefore);

    // Pulse Tree should have leaves from both calls
    const state = getAgentPulseState(agentDid);
    expect(state).not.toBeNull();
    expect(state!.leafCount).toBeGreaterThanOrEqual(2);
  });

  // ─── Step 5: Trust Oracle sees Pulse Tree activity ───────────────────────

  it('trust oracle returns meaningful score after agent activity', async () => {
    // Generate some activity: make 3 calls
    for (let i = 0; i < 3; i++) {
      mockX402Call({ price: 10 + i, round: i });
      await callEndpoint(app, ENDPOINT_ID, {
        apiKey: agentApiKey,
        params: { mintAddress: `trust-test-${i}` },
      });
    }

    // Query trust at all tiers
    const basic = queryTrust(agentDid, 'basic');
    expect(basic.trustScore).toBeGreaterThanOrEqual(0);
    expect(basic.trustVerdict).toBeTruthy();

    const dimensional = queryTrust(agentDid, 'dimensional');
    expect(dimensional.dimensions).toBeTruthy();
    expect(dimensional.dimensions!.reliability.score).toBeGreaterThanOrEqual(0);

    const full = queryTrust(agentDid, 'full');
    expect(full.pulse).toBeTruthy();
    expect(full.pulse!.heartbeatIndex).toBeGreaterThanOrEqual(3);
    expect(full.pulse!.leafCount).toBeGreaterThanOrEqual(3);
    expect(full.recentActivity).toBeTruthy();
    expect(full.recentActivity!.actionsLast24h).toBeGreaterThan(0);
  });

  // ─── Step 6: Trust query charges credits via HTTP route ──────────────────

  it('trust query HTTP endpoint charges credits', async () => {
    // Generate activity first
    await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'trust-charge-test' },
    });

    const creditsBefore = getApiKeyBalance(agentApiKey)!.credits;

    // Hit the basic trust endpoint via HTTP
    const res = await app.request(`/v1/trust/${agentDid}`, {
      method: 'GET',
      headers: { 'X-API-Key': agentApiKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trustScore).toBeGreaterThanOrEqual(0);
    expect(body._meta.tier).toBe('basic');
    expect(body._meta.creditsCharged).toBe(TRUST_QUERY_COSTS.basic);

    // Credits charged
    const creditsAfter = getApiKeyBalance(agentApiKey)!.credits;
    expect(creditsAfter).toBe(creditsBefore - TRUST_QUERY_COSTS.basic);
  });

  // ─── Step 7: Vouch graph affects trust social dimension ──────────────────

  it('vouching for an agent affects its trust social dimension', async () => {
    // Generate activity so trust isn't just "new"
    for (let i = 0; i < 3; i++) {
      mockX402Call({ value: i });
      await callEndpoint(app, ENDPOINT_ID, {
        apiKey: agentApiKey,
        params: { mintAddress: `vouch-test-${i}` },
      });
    }

    // Create a second agent to be the voucher
    const voucher = seedApiKey(getTestDb(), { key: validApiKey(), credits: 200 });
    const voucherDid = resolveAgentDid(voucher.key);

    // Get trust before vouch
    const trustBefore = queryTrust(agentDid, 'dimensional');
    const socialBefore = trustBefore.dimensions?.social?.score ?? 0;

    // Vouch for the agent
    stakeVouch(voucherDid, agentDid, 10.0);

    // Verify vouch score
    const score = getVouchScore(agentDid);
    expect(score.totalStaked).toBe(10.0);
    expect(score.uniqueVouchers).toBe(1);

    // Trust social dimension should increase
    const trustAfter = queryTrust(agentDid, 'dimensional');
    expect(trustAfter.dimensions!.social.score).toBeGreaterThan(socialBefore);
  });

  // ─── Step 8: Vouch HTTP routes work ──────────────────────────────────────

  it('vouch stake + score via HTTP routes', async () => {
    // Create two agents
    const voucherSeed = seedApiKey(getTestDb(), { key: validApiKey(), credits: 200 });
    const targetSeed = seedApiKey(getTestDb(), { key: validApiKey(), credits: 50 });
    const targetDid = resolveAgentDid(targetSeed.key);

    // Stake via HTTP
    const stakeRes = await app.request('/v1/vouch/graph/stake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': voucherSeed.key,
      },
      body: JSON.stringify({ voucheeDid: targetDid, stakeAmount: 5.0 }),
    });
    expect(stakeRes.status).toBe(200);
    const stakeBody = await stakeRes.json();
    expect(stakeBody.ok).toBe(true);

    // Score via HTTP (public, no auth)
    const scoreRes = await app.request(`/v1/vouch/graph/${targetDid}/score`, {
      method: 'GET',
    });
    expect(scoreRes.status).toBe(200);
    const scoreBody = await scoreRes.json();
    expect(scoreBody.totalStaked).toBe(5.0);
    expect(scoreBody.uniqueVouchers).toBe(1);
  });

  // ─── Step 9: Provider revenue share on endpoint calls ────────────────────

  it('provider earns revenue share on live calls', async () => {
    // Check provider analytics before
    const analyticsBefore = getDb().prepare(
      'SELECT COALESCE(SUM(calls), 0) as calls, COALESCE(SUM(revenue_usdc), 0) as rev FROM provider_analytics WHERE provider_id = ?'
    ).get(providerId) as { calls: number; rev: number };

    await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'revenue-test' },
    });

    const analyticsAfter = getDb().prepare(
      'SELECT COALESCE(SUM(calls), 0) as calls, COALESCE(SUM(revenue_usdc), 0) as rev FROM provider_analytics WHERE provider_id = ?'
    ).get(providerId) as { calls: number; rev: number };

    expect(analyticsAfter.calls).toBeGreaterThan(analyticsBefore.calls);
    expect(analyticsAfter.rev).toBeGreaterThan(analyticsBefore.rev);
  });

  // ─── Step 10: Multiple calls accumulate Pulse Tree leaves ────────────────

  it('multiple calls produce correct leaf count and root progression', async () => {
    const callCount = 5;
    const roots: string[] = [];

    for (let i = 0; i < callCount; i++) {
      mockX402Call({ iteration: i, data: `batch-${i}` });
      await callEndpoint(app, ENDPOINT_ID, {
        apiKey: agentApiKey,
        params: { mintAddress: `batch-${i}` },
      });
      const state = getAgentPulseState(agentDid);
      if (state) roots.push(state.root);
    }

    const finalState = getAgentPulseState(agentDid);
    expect(finalState).not.toBeNull();
    expect(finalState!.leafCount).toBe(callCount);
    expect(finalState!.heartbeatIndex).toBe(callCount);

    // Each append should change the root (MMR property)
    const uniqueRoots = new Set(roots);
    expect(uniqueRoots.size).toBe(callCount);
  });

  // ─── Step 11: Insufficient credits rejected ──────────────────────────────

  it('rejects call when agent has insufficient credits', async () => {
    const poor = seedApiKey(getTestDb(), { key: validApiKey(), credits: 0.0001 });

    const res = await callEndpoint(app, ENDPOINT_ID, {
      apiKey: poor.key,
      params: { mintAddress: 'broke-test' },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
  });

  // ─── Step 12: Soma Check telemetry logged ────────────────────────────────

  it('Soma Check events are logged for shadow telemetry', async () => {
    // Make a call to generate a hash
    mockX402Call({ stable: true });
    await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'telemetry-test' },
    });

    // Check soma_check_events table
    const events = getDb().prepare(
      'SELECT * FROM soma_check_events WHERE endpoint_id = ? ORDER BY created_at DESC'
    ).all(ENDPOINT_ID) as any[];

    expect(events.length).toBeGreaterThan(0);
    const latest = events[0];
    expect(latest.endpoint_id).toBe(ENDPOINT_ID);
    expect(latest.hash).toBeTruthy();
  });

  // ─── Step 13: Full lifecycle — register → call → check → trust → vouch ──

  it('complete lifecycle: call → Soma Check → trust → vouch → verify', async () => {
    // 1. Agent calls endpoint (live)
    mockX402Call({ weather: 'sunny', temp: 72 });
    const res1 = await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'full-lifecycle' },
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    const dataHash = body1.dataHash;

    // 2. Agent sends Soma Check — data unchanged
    const res2 = await callEndpoint(app, ENDPOINT_ID, {
      apiKey: agentApiKey,
      params: { mintAddress: 'full-lifecycle' },
      ifSomaHash: dataHash,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.unchanged).toBe(true);

    // 3. Pulse Tree now has 2 leaves (live + check)
    const pulseState = getAgentPulseState(agentDid);
    expect(pulseState!.leafCount).toBe(2);

    // 4. Trust query sees the activity
    const trust = queryTrust(agentDid, 'full');
    expect(trust.trustScore).toBeGreaterThanOrEqual(0);
    expect(trust.pulse!.leafCount).toBe(2);
    expect(trust.recentActivity!.actionsLast24h).toBe(2);

    // 5. Another agent vouches for us
    const voucher = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    const voucherDid = resolveAgentDid(voucher.key);
    stakeVouch(voucherDid, agentDid, 5.0);

    // 6. Trust social dimension now reflects vouch
    const trustAfterVouch = queryTrust(agentDid, 'dimensional');
    expect(trustAfterVouch.dimensions!.social.score).toBeGreaterThan(0);

    // 7. Verify credits were metered correctly throughout
    const finalBalance = getApiKeyBalance(agentApiKey)!;
    expect(finalBalance.credits).toBeLessThan(500); // started with 500
    expect(finalBalance.credits_used).toBeGreaterThan(0);
  });
});
