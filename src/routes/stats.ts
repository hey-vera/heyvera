import { Hono } from 'hono';
import { getDb, getDbStats, getActiveUserCount, getRevenueBreakdown, getReputationAnchors, getReputationAnchor, verifyReputationAnchor } from '../db/index';
import { apiRegistry, getRegistryStats } from '../config/api-registry';
import { getLastDiscoveryResult } from '../core/endpoint-discovery';
import { round6 } from '../core/credits';

const statsRouter = new Hono();

// Public — no auth required. Backs the live stats bar on the homepage.
// NOTE: Do NOT expose circuit breaker state (operational vs down endpoints)
// on this unauthenticated endpoint — it reveals which providers are failing,
// which is useful to attackers and competitors.
statsRouter.get('/', (c) => {
  const db = getDbStats();
  const endpointCount = apiRegistry.length;
  const activeUsers = getActiveUserCount();

  const registryStats = getRegistryStats();
  const lastDiscovery = getLastDiscoveryResult();

  return c.json({
    totalCalls: db.totalOrchestrations,
    avgDurationMs: db.avgDurationMs,
    successRate: db.successRate,
    activeUsers,
    endpoints: {
      total: endpointCount,
      static: endpointCount - registryStats.discovered,
      discovered: registryStats.discovered,
      byProvider: registryStats.byProvider,
    },
    discovery: lastDiscovery ?? { status: 'pending' },
    updatedAt: new Date().toISOString(),
  });
});

// ─── Public Roadmap Stats ─────────────────────────────────────────────────────
// Powers the roadmap page progress bar. No auth required.
// Exposes only aggregate revenue — no breakdown, no per-user data.

const MILESTONES = [
  { name: 'Checkpoint 1',   target: 25_000, description: 'Early traction — proving product-market fit' },
  { name: 'Checkpoint 2',   target: 50_000, description: 'Sustainable growth — ready for token infrastructure' },
  { name: 'Launch',         target: 100_000, description: 'Full launch with real liquidity, marketing + exchange listings' },
];

statsRouter.get('/roadmap', (c) => {
  const rev = getRevenueBreakdown();
  // Use PLATFORM FEES (actual earned revenue), not gross customer payments.
  // payments.totalUsd = what customers paid us (gross).
  // totalPlatformUsdEquiv = what the platform actually earned (net revenue from fees).
  // The roadmap tracks NET revenue — what we actually earned, not what customers deposited.
  const totalRevenueUsd = rev.totalPlatformUsdEquiv;
  const platformCreditsEarned = rev.totalPlatformCredits;
  const users = rev.payments.keyCount;

  const launchTarget = 100_000;
  const currentMilestone = MILESTONES.find(m => totalRevenueUsd < m.target) ?? MILESTONES[MILESTONES.length - 1];
  const progress = Math.min(100, Math.round((totalRevenueUsd / launchTarget) * 10000) / 100);

  return c.json({
    revenue: {
      totalUsd: Math.round(totalRevenueUsd * 100) / 100,
      platformFeesCredits: platformCreditsEarned,
      platformFeesUsd: Math.round(totalRevenueUsd * 100) / 100,
      users,
    },
    milestones: MILESTONES.map(m => ({
      name: m.name,
      targetUsd: m.target,
      reached: totalRevenueUsd >= m.target,
      description: m.description,
    })),
    current: {
      milestone: currentMilestone.name,
      targetUsd: currentMilestone.target,
      progressPct: progress,
    },
    tokenLaunch: {
      status: totalRevenueUsd >= 100_000 ? 'READY' : totalRevenueUsd >= 50_000 ? 'VIABLE' : 'BUILDING',
      split: { burn: 50, buybackLp: 20, treasury: 15, rewards: 15 },
    },
    updatedAt: new Date().toISOString(),
  });
});

// ─── Public Skill Health Metrics ─────────────────────────────────────────────
// No auth — designed for 402index.io and similar directories to crawl.
// Exposes health data already collected by skill-health-cron (every 15m).

interface HealthSkillRow {
  id: string;
  name: string;
  skill_type: string;
  health_status: string;
  health_checked_at: string | null;
  avg_latency_ms: number;
  success_rate: number;
  avg_rating: number;
  rating_count: number;
  proxy_url: string | null;
}

statsRouter.get('/health/skills', (c) => {
  const skills = getDb().prepare(
    `SELECT id, name, skill_type, health_status, health_checked_at,
            avg_latency_ms, success_rate, avg_rating, rating_count, proxy_url
     FROM skills
     WHERE active = 1 AND public = 1 AND security_status != 'FLAGGED'
     ORDER BY health_status ASC, name ASC
     LIMIT 500`
  ).all() as HealthSkillRow[];

  const total = skills.length;
  const healthy = skills.filter(s => s.health_status === 'HEALTHY').length;
  const degraded = skills.filter(s => s.health_status === 'DEGRADED').length;
  const down = total - healthy - degraded;
  const uptimePct = total > 0 ? round6((healthy / total) * 100) : 100;

  const overallStatus = down > total * 0.5 ? 'major_outage'
    : degraded + down > total * 0.25 ? 'partial_outage'
    : degraded > 0 ? 'degraded'
    : 'operational';

  return c.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checkIntervalMinutes: 15,
    summary: {
      total,
      healthy,
      degraded,
      down,
      uptimePct,
    },
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      status: s.health_status,
      avgLatencyMs: Math.round(s.avg_latency_ms),
      successRate: round6(s.success_rate / 100), // stored as 0-100, expose as 0-1
      avgRating: round6(s.avg_rating),
      ratingCount: s.rating_count,
      lastChecked: s.health_checked_at ?? null,
      protocol: s.proxy_url ? 'x402' : s.skill_type === 'prompt_template' ? 'credits' : 'credits',
      skillType: s.skill_type,
    })),
  });
});

// ─── Opportunities / Gap Analysis ────────────────────────────────────────────
// Public — no auth required. Identifies marketplace gaps to attract developers.
// Modeled after 402index.io GET /api/v1/opportunities.

interface OpportunitySkillRow {
  id: string;
  name: string;
  skill_type: string;
  tags_json: string | null;
  category: string;
  credit_cost: number;
  author_key: string;
  health_status: string;
  success_rate: number;
  avg_rating: number;
  rating_count: number;
  uses: number;
}

statsRouter.get('/opportunities', (c) => {
  const skills = getDb().prepare(
    `SELECT id, name, skill_type, tags_json, category, credit_cost, author_key,
            health_status, success_rate, avg_rating, rating_count, uses
     FROM skills
     WHERE active = 1 AND public = 1 AND security_status != 'FLAGGED'
     ORDER BY name ASC
     LIMIT 1000`
  ).all() as OpportunitySkillRow[];

  const totalSkills = skills.length;

  // ── Build tag → skills map ──────────────────────────────────────────────────
  const tagSkills = new Map<string, OpportunitySkillRow[]>();
  for (const skill of skills) {
    const tags: string[] = [];
    if (skill.tags_json) {
      try {
        const parsed = JSON.parse(skill.tags_json);
        if (Array.isArray(parsed)) tags.push(...parsed.map((t: string) => t.toLowerCase().trim()));
      } catch { /* skip bad JSON */ }
    }
    if (skill.category) tags.push(skill.category.toLowerCase().trim());
    const unique = [...new Set(tags)];
    for (const tag of unique) {
      if (!tag) continue;
      const list = tagSkills.get(tag) ?? [];
      list.push(skill);
      tagSkills.set(tag, list);
    }
  }

  const allTags = [...tagSkills.keys()];

  // ── Underserved categories (≤ 2 skills) ─────────────────────────────────────
  const underservedCategories = allTags
    .filter(tag => (tagSkills.get(tag)?.length ?? 0) <= 2)
    .map(tag => {
      const tagList = tagSkills.get(tag)!;
      const avgRating = tagList.length > 0
        ? round6(tagList.reduce((s, sk) => s + sk.avg_rating, 0) / tagList.length)
        : 0;
      return {
        tag,
        skillCount: tagList.length,
        avgRating,
        reason: tagList.length === 1
          ? 'Only 1 skill in this category — high opportunity'
          : `Only ${tagList.length} skills — room for more competition`,
      };
    })
    .sort((a, b) => a.skillCount - b.skillCount);

  // ── Single-provider risks (all skills in a tag from one creator) ────────────
  const singleProviderRisks: { tag: string; provider: string; skillCount: number; reason: string }[] = [];
  for (const [tag, tagList] of tagSkills) {
    if (tagList.length < 2) continue; // single-skill tags already covered above
    const providers = new Set(tagList.map(s => s.author_key));
    if (providers.size === 1) {
      singleProviderRisks.push({
        tag,
        provider: tagList[0].author_key,
        skillCount: tagList.length,
        reason: 'All skills from single provider — no redundancy',
      });
    }
  }

  // ── Degraded skills (health_status DEGRADED/DOWN or success_rate < 80) ──────
  const degradedSkills = skills
    .filter(s => s.health_status === 'DEGRADED' || s.health_status === 'DOWN' || s.success_rate < 80)
    .map(s => ({
      id: s.id,
      name: s.name,
      healthStatus: s.health_status,
      successRate: round6(s.success_rate / 100), // stored 0-100, expose as 0-1
      reason: s.health_status === 'DOWN'
        ? 'Skill is DOWN — immediate replacement opportunity'
        : s.health_status === 'DEGRADED'
          ? 'Degraded health — replacement opportunity'
          : `Below 80% success rate (${round6(s.success_rate / 100)}) — reliability opportunity`,
    }));

  // ── Missing capabilities (static, based on known platform gaps) ─────────────
  const knownCapabilities: { capability: string; reason: string; detectTag?: string }[] = [
    { capability: 'real-time-streaming', reason: 'No skills offer real-time data streaming', detectTag: 'streaming' },
    { capability: 'multi-chain-defi', reason: 'DeFi skills only cover Solana — missing EVM chains', detectTag: 'multi-chain' },
    { capability: 'image-generation', reason: 'No image generation skills available', detectTag: 'image-generation' },
    { capability: 'voice-transcription', reason: 'No voice/audio transcription skills', detectTag: 'voice' },
    { capability: 'code-execution', reason: 'No sandboxed code execution skills', detectTag: 'code-execution' },
    { capability: 'web-scraping', reason: 'No structured web scraping skills', detectTag: 'scraping' },
  ];
  const missingCapabilities = knownCapabilities
    .filter(cap => !cap.detectTag || !tagSkills.has(cap.detectTag))
    .map(({ capability, reason }) => ({ capability, reason }));

  // ── Pricing gaps (tags where avg credit_cost > 10) ──────────────────────────
  const pricingGaps: { tag: string; avgCreditCost: number; reason: string }[] = [];
  for (const [tag, tagList] of tagSkills) {
    const avg = round6(tagList.reduce((s, sk) => s + sk.credit_cost, 0) / tagList.length);
    if (avg > 10) {
      pricingGaps.push({
        tag,
        avgCreditCost: avg,
        reason: 'High average cost — room for cheaper alternatives',
      });
    }
  }
  pricingGaps.sort((a, b) => b.avgCreditCost - a.avgCreditCost);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const healthyCount = skills.filter(s => s.health_status === 'HEALTHY').length;
  const healthyPct = totalSkills > 0 ? round6((healthyCount / totalSkills) * 100) : 100;
  const avgCreditCost = totalSkills > 0
    ? round6(skills.reduce((s, sk) => s + sk.credit_cost, 0) / totalSkills)
    : 0;

  return c.json({
    timestamp: new Date().toISOString(),
    opportunities: {
      underservedCategories,
      singleProviderRisks,
      degradedSkills,
      missingCapabilities,
      pricingGaps,
    },
    summary: {
      totalSkills,
      totalTags: allTags.length,
      healthyPct,
      avgCreditCost,
    },
  });
});

// ─── Reputation Hash Anchors ─────────────────────────────────────────────────
// Public — no auth required. External systems can verify ClawNet trust data
// without trusting our API by checking SHA-256 hashes of reputation snapshots.

statsRouter.get('/reputation/:skillId', (c) => {
  const skillId = c.req.param('skillId');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 10, 100) : 10;

  const anchors = getReputationAnchors(skillId, limit);
  if (anchors.length === 0) {
    // Check if the skill exists at all
    const skill = getDb().prepare('SELECT id FROM skills WHERE id = ? AND active = 1').get(skillId);
    if (!skill) {
      return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
    }
  }

  return c.json({
    skillId,
    anchors: anchors.map(a => ({
      id: a.id,
      hash: a.anchor_hash,
      snapshot: JSON.parse(a.data_snapshot),
      anchorType: a.anchor_type,
      createdAt: a.created_at,
    })),
    verifyUrl: '/v1/stats/reputation/verify/:anchorId',
  });
});

statsRouter.get('/reputation/verify/:anchorId', (c) => {
  const anchorId = c.req.param('anchorId');
  const { valid, anchor } = verifyReputationAnchor(anchorId);

  if (!anchor) {
    return c.json({ error: 'Anchor not found', code: 'ANCHOR_NOT_FOUND' }, 404);
  }

  return c.json({
    valid,
    anchorId: anchor.id,
    hash: anchor.anchor_hash,
    skillId: anchor.skill_id,
    createdAt: anchor.created_at,
  });
});

export { statsRouter };
