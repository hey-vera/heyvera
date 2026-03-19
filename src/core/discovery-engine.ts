/**
 * Discovery Trinity Engine
 * Aggregates three independent discovery layers with configurable weights.
 * Gracefully degrades if any layer fails or returns no results.
 */
import { embed, isEmbeddingModelReady } from './embeddings';
import { searchDiscovery, getPeers, getDb } from '../db/index';
import { getMeshNode } from '../mesh/node';
import { logger } from '../utils/logger';
import { searchAg0Agents } from '../integrations/ag0';
import discoveryConfig from '../config/discovery.json';

export interface DiscoveryResult {
  id: string;
  name: string;
  description: string;
  provider: string;
  source: 'semantic' | 'p2p' | 'onchain' | 'ag0';
  score: number;
}

export interface DiscoveryOptions {
  query: string;
  limit?: number;
  filters?: { provider?: string; source?: string[] };
  weights?: { semantic?: number; p2p?: number; onchain?: number };
}

// ─── Layer: Semantic (sqlite-vec) ─────────────────────────────────────────────

async function semanticLayer(query: string, limit: number): Promise<DiscoveryResult[]> {
  if (!isEmbeddingModelReady()) return [];
  try {
    const vec = await embed(query);
    const rows = searchDiscovery(vec, limit);
    return rows.map(r => ({
      id: r.id,
      name: r.skillName,
      description: r.skillDesc,
      provider: r.provider,
      source: 'semantic' as const,
      score: +(1 - r.distance).toFixed(4),
    }));
  } catch (err) {
    logger.warn({ err }, 'Semantic discovery layer failed');
    return [];
  }
}

// ─── Layer: P2P (libp2p mesh peers) ──────────────────────────────────────────

function p2pLayer(query: string, limit: number): DiscoveryResult[] {
  try {
    getMeshNode(); // ensure mesh is running (no-op if not)
    const peers = getPeers();
    if (peers.length === 0) return [];

    const q = query.toLowerCase();
    // Filter out very short words (≤2 chars) to prevent false-positive matches on "a", "to", etc.
    const words = q.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return [];

    return peers
      .filter(p => p.metadata_json)
      .map(p => {
        let meta: { name?: string; description?: string; capabilities?: string[] } = {};
        try { meta = JSON.parse(p.metadata_json!); } catch { return null; }
        const text = [meta.name, meta.description, ...(meta.capabilities ?? [])].join(' ').toLowerCase();
        const matchCount = words.filter(w => text.includes(w)).length;
        if (matchCount === 0) return null;
        return {
          id: `peer:${p.id}`,
          name: meta.name ?? p.id.slice(0, 12),
          description: meta.description ?? `P2P agent at ${p.multiaddr}`,
          provider: 'p2p',
          source: 'p2p' as const,
          score: +(matchCount / words.length).toFixed(4),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map(r => r as DiscoveryResult)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    logger.warn({ err }, 'P2P discovery layer failed');
    return [];
  }
}

// ─── Layer: On-chain (ERC-8004 mock — real implementation in future) ──────────

function onchainLayer(query: string, limit: number): DiscoveryResult[] {
  // ERC-8004 on-chain registry is not yet deployed.
  // Return mock entries that match common query patterns until real contract is live.
  try {
    const q = query.toLowerCase();
    const mockAgents = [
      { id: 'onchain:claw-orchestrator', name: 'ClawNet Orchestrator', description: 'Universal AI workflow orchestration with 75+ API endpoints', capabilities: ['orchestration', 'api', 'workflow', 'ai'] },
      { id: 'onchain:claw-token-analyst', name: 'Token Analyst', description: 'Solana token analysis: price, on-chain metrics, sentiment', capabilities: ['token', 'defi', 'solana', 'analysis', 'crypto'] },
      { id: 'onchain:claw-social', name: 'Social Intelligence', description: 'Twitter/X sentiment analysis and social monitoring', capabilities: ['twitter', 'social', 'sentiment', 'x', 'monitoring'] },
    ];
    const words = q.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return [];
    return mockAgents
      .map(agent => {
        const text = [agent.name, agent.description, ...agent.capabilities].join(' ').toLowerCase();
        const matchCount = words.filter(w => text.includes(w)).length;
        if (matchCount === 0) return null;
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          provider: 'onchain',
          source: 'onchain' as const,
          score: +(matchCount / words.length * 0.8).toFixed(4), // slight discount — mock data
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map(r => r as DiscoveryResult)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    logger.warn({ err }, 'On-chain discovery layer failed');
    return [];
  }
}

// ─── Layer: ag0 (decentralized agent registry — ERC-721 on The Graph) ────────

async function ag0Layer(query: string, limit: number): Promise<DiscoveryResult[]> {
  try {
    const agents = await searchAg0Agents(query, limit);
    return agents.map(a => ({
      id: `ag0:${a.id}`,
      name: a.name,
      description: a.description,
      provider: 'ag0',
      source: 'ag0' as const,
      score: +Math.min(a.reputationScore / 100, 1).toFixed(4), // normalize 0-100 → 0-1
    }));
  } catch (err) {
    logger.warn({ err }, 'ag0 discovery layer failed');
    return [];
  }
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export async function runDiscovery(opts: DiscoveryOptions): Promise<{
  results: DiscoveryResult[];
  layerStats: Record<string, { count: number; weight: number; active: boolean }>;
}> {
  const limit = opts.limit ?? discoveryConfig.resultLimit;
  const cfg = discoveryConfig.weights;
  const requestedWeights = opts.weights ?? {};

  const rawWeights = {
    semantic: requestedWeights.semantic ?? cfg.semantic,
    p2p:      requestedWeights.p2p      ?? cfg.p2p,
    onchain:  requestedWeights.onchain  ?? cfg.onchain,
  };

  // Run all three layers in parallel
  const [semanticResults, p2pResults, onchainResults] = await Promise.all([
    semanticLayer(opts.query, discoveryConfig.semanticLimit),
    Promise.resolve(p2pLayer(opts.query, discoveryConfig.p2pLimit)),
    Promise.resolve(onchainLayer(opts.query, discoveryConfig.onchainLimit)),
  ]);

  // ag0 fallback: when local discovery finds < 3 results, also query the
  // decentralized agent registry. Runs after the main layers so it only
  // fires when local results are sparse — keeps latency low in common case.
  const localResultCount = semanticResults.length + p2pResults.length + onchainResults.length;
  const ag0Results = localResultCount < 3
    ? await ag0Layer(opts.query, 10)
    : [];

  // Graceful degradation: re-weight active layers if some returned nothing
  const activeWeights = { ...rawWeights, ag0: 0.10 };
  if (semanticResults.length === 0) { activeWeights.semantic = 0; }
  if (p2pResults.length === 0)      { activeWeights.p2p = 0; }
  if (onchainResults.length === 0)  { activeWeights.onchain = 0; }
  if (ag0Results.length === 0)      { activeWeights.ag0 = 0; }

  const totalWeight = activeWeights.semantic + activeWeights.p2p + activeWeights.onchain + activeWeights.ag0;
  if (totalWeight > 0) {
    activeWeights.semantic /= totalWeight;
    activeWeights.p2p      /= totalWeight;
    activeWeights.onchain  /= totalWeight;
    activeWeights.ag0      /= totalWeight;
  }

  // Merge, deduplicate by id, re-score by weighted layer scores
  const scoreMap = new Map<string, DiscoveryResult>();

  const applyLayer = (results: DiscoveryResult[], weight: number) => {
    for (const r of results) {
      const existing = scoreMap.get(r.id);
      const contribution = r.score * weight;
      if (existing) {
        existing.score = +(existing.score + contribution).toFixed(4);
      } else {
        scoreMap.set(r.id, { ...r, score: +contribution.toFixed(4) });
      }
    }
  };

  applyLayer(semanticResults, activeWeights.semantic);
  applyLayer(p2pResults,      activeWeights.p2p);
  applyLayer(onchainResults,  activeWeights.onchain);
  applyLayer(ag0Results,      activeWeights.ag0);

  // Apply provider filter
  let merged = Array.from(scoreMap.values());
  if (opts.filters?.provider) {
    merged = merged.filter(r => r.provider.toLowerCase() === opts.filters!.provider!.toLowerCase());
  }
  if (opts.filters?.source?.length) {
    merged = merged.filter(r => opts.filters!.source!.includes(r.source));
  }

  // Staking boost: skills with active stakes get a discovery ranking bonus
  // Each 100 staked credits adds ~5% score boost (diminishing returns via sqrt)
  try {
    const skillIds = merged
      .map(r => r.id.replace('skill:', ''))
      .filter(id => !id.startsWith('peer:') && !id.startsWith('onchain:'));
    if (skillIds.length > 0) {
      const placeholders = skillIds.map(() => '?').join(',');
      const stakeRows = getDb().prepare(
        `SELECT skill_id, SUM(amount_credits) as total_staked
         FROM stakes WHERE skill_id IN (${placeholders}) AND unlocked = 0
         GROUP BY skill_id`
      ).all(...skillIds) as { skill_id: string; total_staked: number }[];
      const stakeMap = new Map(stakeRows.map(r => [r.skill_id, r.total_staked]));
      for (const r of merged) {
        const rawId = r.id.replace('skill:', '');
        const staked = stakeMap.get(rawId);
        if (staked && staked > 0) {
          // sqrt-based diminishing boost: 100 cr → 5%, 400 cr → 10%, 1600 cr → 20%
          const boost = Math.sqrt(staked / 100) * 0.05;
          r.score = +(r.score * (1 + Math.min(boost, 0.5))).toFixed(4); // cap at 50% boost
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Staking boost calculation failed — proceeding without boost');
  }

  merged.sort((a, b) => b.score - a.score);
  const results = merged.slice(0, limit);

  const layerStats = {
    semantic: { count: semanticResults.length, weight: +activeWeights.semantic.toFixed(3), active: semanticResults.length > 0 },
    p2p:      { count: p2pResults.length,      weight: +activeWeights.p2p.toFixed(3),      active: p2pResults.length > 0 },
    onchain:  { count: onchainResults.length,  weight: +activeWeights.onchain.toFixed(3),  active: onchainResults.length > 0 },
    ag0:      { count: ag0Results.length,       weight: +activeWeights.ag0.toFixed(3),       active: ag0Results.length > 0 },
  };

  logger.debug({ query: opts.query, layerStats, resultsReturned: results.length }, 'Discovery query completed');

  return { results, layerStats };
}
