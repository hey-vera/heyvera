/**
 * ag0 Agent Discovery — queries the ag0 subgraph for external agents
 *
 * ag0 uses The Graph (GraphQL) to index ERC-721 agent registrations.
 * We query the public subgraph endpoint — no SDK dependency needed.
 */
import { env } from '../config/index';
import { logger } from '../utils/logger';

const DEFAULT_AG0_SUBGRAPH_URL =
  'https://api.thegraph.com/subgraphs/name/ag0-protocol/agent-registry';

export interface Ag0Agent {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  capabilities: string[];
  reputationScore: number;
  owner: string;
  chainId: string;
}

/**
 * Sanitize user input before embedding in a GraphQL string literal.
 * Strips anything that could break out of the quoted value.
 */
function sanitize(input: string): string {
  return input
    .replace(/[\\"]/g, '')      // strip quotes and backslashes
    .replace(/[{}\n\r]/g, '')   // strip braces and newlines
    .replace(/[^\x20-\x7E]/g, '') // ASCII printable only
    .slice(0, 200);             // hard length cap
}

/**
 * Parse a raw subgraph agent record into our Ag0Agent shape.
 * Metadata (name, description, endpoint, capabilities) lives in metadataURI
 * which points to IPFS JSON. For now we derive what we can from on-chain fields
 * and fall back to the description_contains match text.
 */
function parseAg0Agent(raw: {
  id: string;
  name?: string;
  description?: string;
  metadataURI?: string;
  reputationScore?: string | number;
  owner?: string;
  chainId?: string;
  endpoint?: string;
  capabilities?: string[];
}): Ag0Agent {
  return {
    id: raw.id ?? '',
    name: raw.name ?? `ag0-agent-${(raw.id ?? '').slice(0, 8)}`,
    description: raw.description ?? '',
    endpoint: raw.endpoint ?? '',
    capabilities: raw.capabilities ?? [],
    reputationScore: Number(raw.reputationScore ?? 0),
    owner: raw.owner ?? '',
    chainId: raw.chainId ?? '1',
  };
}

/**
 * Search ag0 registry for agents matching a capability query.
 * Returns empty array on any failure — never blocks orchestration.
 */
export async function searchAg0Agents(query: string, limit = 5): Promise<Ag0Agent[]> {
  if (!env.AG0_DISCOVERY_ENABLED) return [];

  const subgraphUrl = env.AG0_SUBGRAPH_URL ?? DEFAULT_AG0_SUBGRAPH_URL;

  try {
    const graphqlQuery = {
      query: `{
        agents(
          first: ${Math.min(Math.max(1, limit), 20)},
          where: { description_contains_nocase: "${sanitize(query)}" },
          orderBy: reputationScore,
          orderDirection: desc
        ) {
          id
          name
          description
          metadataURI
          reputationScore
          owner
        }
      }`,
    };

    const res = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphqlQuery),
      signal: AbortSignal.timeout(5000), // 5s — never block orchestration
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, '[ag0] Subgraph returned non-OK status');
      return [];
    }

    const data = await res.json();
    return (data?.data?.agents || []).map(parseAg0Agent);
  } catch (err) {
    logger.warn({ err }, '[ag0] Discovery query failed');
    return []; // Never block orchestration on ag0 failures
  }
}

/**
 * Call an ag0 agent's endpoint (they typically expose A2A or REST).
 * Returns the parsed JSON response or null on failure.
 */
export async function callAg0Agent(
  agent: Ag0Agent,
  payload: unknown,
): Promise<unknown> {
  if (!agent.endpoint) {
    logger.warn({ agentId: agent.id }, '[ag0] Agent has no endpoint — cannot call');
    return null;
  }

  // SSRF guard — block private/localhost endpoints
  try {
    const url = new URL(agent.endpoint);
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0'
    ) {
      logger.warn({ agentId: agent.id, host }, '[ag0] Blocked call to localhost agent');
      return null;
    }
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) {
      logger.warn({ agentId: agent.id, host }, '[ag0] Blocked call to private network agent');
      return null;
    }
  } catch {
    logger.warn({ agentId: agent.id, endpoint: agent.endpoint }, '[ag0] Invalid agent endpoint URL');
    return null;
  }

  try {
    const res = await fetch(agent.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!res.ok) {
      logger.warn({ agentId: agent.id, status: res.status }, '[ag0] Agent call returned non-OK');
      return null;
    }

    return await res.json();
  } catch (err) {
    logger.warn({ agentId: agent.id, err }, '[ag0] Agent call failed');
    return null;
  }
}
