/**
 * plan-templates.ts
 *
 * Pre-built execution plans for common query patterns.
 * When a query matches a template, we skip the LLM intent parser entirely
 * (saving ~3-5 seconds) and return a deterministic plan immediately.
 *
 * Templates are checked in order. First match wins.
 * Fallback: query goes to LLM if no template matches.
 */

import type { ParsedIntent } from './intent-parser';

export interface PlanTemplate {
  /** Human-readable name for logging */
  name: string;
  /** Regex patterns — tested against lowercased, trimmed query */
  patterns: RegExp[];
  /**
   * Build a ParsedIntent from the query and any named capture groups.
   * Return null to fall through to LLM (e.g. if required param missing).
   */
  build: (query: string, match: RegExpMatchArray) => ParsedIntent | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract token symbol or mint address from a match group */
function tokenParam(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  const t = raw.trim();
  // Looks like a Solana mint address (32-44 base58 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return { mintAddress: t };
  // Symbol — uppercase
  return { symbol: t.toUpperCase() };
}

function walletParam(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return { walletAddress: t };
  return null;
}

function singleStep(
  endpointId: string,
  params: Record<string, string>,
  reason: string,
  summary: string,
): ParsedIntent {
  return {
    summary,
    reasoning: `Template match — single endpoint, no LLM needed`,
    steps: [{ endpointId, params, dependsOn: [], reason }],
    parallelGroups: [['0']],
  };
}

function parallelSteps(
  steps: Array<{ endpointId: string; params: Record<string, string>; reason: string }>,
  summary: string,
): ParsedIntent {
  return {
    summary,
    reasoning: `Template match — parallel group, no LLM needed`,
    steps: steps.map((s) => ({ ...s, dependsOn: [] })),
    parallelGroups: [steps.map((_, i) => String(i))],
  };
}

// ─── Template Registry ────────────────────────────────────────────────────────

export const PLAN_TEMPLATES: PlanTemplate[] = [

  // ── Price check ───────────────────────────────────────────────────────────
  {
    name: 'token-price',
    patterns: [
      /^(?:what(?:'s| is)(?: the)? )?(?:current )?price(?: of)?\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})(?:\s+(?:right now|today|now|atm))?[?.]?$/,
      /^(?:how much is|how much does)\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+(?:cost|worth|trading at|trading for|sell for)[?.]?$/,
      /^(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+price[?.]?$/,
    ],
    build(_, match) {
      const p = tokenParam(match.groups?.token);
      if (!p) return null;
      return singleStep('claw-token-price', p, 'Get current token price', `Price check: ${match.groups?.token}`);
    },
  },

  // ── Token metadata ────────────────────────────────────────────────────────
  {
    name: 'token-metadata',
    patterns: [
      /^(?:what is|tell me about|info (?:on|about)|details (?:on|about)|metadata (?:for|of))\s+(?:the token\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})[?.]?$/,
      /^(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+(?:token\s+)?(?:info|information|details|metadata)[?.]?$/,
    ],
    build(_, match) {
      const p = tokenParam(match.groups?.token);
      if (!p) return null;
      return singleStep('claw-token-metadata', p, 'Get token metadata', `Token info: ${match.groups?.token}`);
    },
  },

  // ── Risk / safety check ───────────────────────────────────────────────────
  {
    name: 'token-risk',
    patterns: [
      /^(?:is\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})\s+(?:a\s+)?(?:safe|rug|scam|legit|legitimate)[?.]?$/,
      /^(?:rug\s+)?(?:risk|safety)\s+(?:check\s+)?(?:for\s+|of\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})[?.]?$/,
      /^is\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+safe to (?:buy|invest|hold|trade)[?.]?$/,
    ],
    build(_, match) {
      const p = tokenParam(match.groups?.token);
      if (!p) return null;
      return singleStep('claw-token-risk', p, 'Check token risk score', `Risk check: ${match.groups?.token}`);
    },
  },

  // ── Trending tokens ───────────────────────────────────────────────────────
  {
    name: 'trending-tokens',
    patterns: [
      /^(?:what(?:'s| are)(?: the)?|show me(?: the)?|list(?: the)?)?\s*(?:top\s+\d+\s+)?trending\s+(?:solana\s+)?tokens?(?:\s+(?:right now|today|now|on solana))?[?.]?$/,
      /^(?:solana\s+)?(?:hot|trending|pumping)\s+(?:tokens?|coins?|memes?)\s*(?:right now|today|now)?[?.]?$/,
      /^what(?:'s| is)\s+(?:pumping|trending|hot)\s+(?:right now|today|on solana)?[?.]?$/,
    ],
    build() {
      return singleStep('claw-trending-tokens', {}, 'Get trending Solana tokens', 'Trending tokens on Solana');
    },
  },

  // ── Wallet balance / portfolio ─────────────────────────────────────────────
  {
    name: 'wallet-portfolio',
    patterns: [
      /^(?:what(?:'s| is)(?: the)? )?(?:balance|portfolio|holdings?)\s+(?:for|of)?\s*(?:wallet\s+)?(?<wallet>[1-9A-HJ-NP-Za-km-z]{32,44})[?.]?$/,
      /^(?:check\s+)?(?:wallet\s+)?(?<wallet>[1-9A-HJ-NP-Za-km-z]{32,44})\s+(?:balance|portfolio|holdings?)[?.]?$/,
      /^(?:how much does|what does)\s+(?:wallet\s+)?(?<wallet>[1-9A-HJ-NP-Za-km-z]{32,44})\s+(?:hold|have|own)[?.]?$/,
    ],
    build(_, match) {
      const p = walletParam(match.groups?.wallet);
      if (!p) return null;
      return singleStep('claw-wallet-portfolio', p, 'Get wallet portfolio', `Wallet portfolio: ${match.groups?.wallet?.slice(0, 8)}...`);
    },
  },

  // ── Token sentiment (X/Twitter) ───────────────────────────────────────────
  {
    name: 'token-sentiment',
    patterns: [
      /^(?:what(?:'s| is)(?: the)? )?(?:twitter|x|social)\s+sentiment\s+(?:for|on|about)\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20})[?.]?$/,
      /^(?:how is\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+(?:sentiment|social|twitter|x buzz)[?.]?$/,
      /^(?:twitter|x)\s+(?:mentions?|buzz|sentiment)\s+(?:for\s+|on\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,20})[?.]?$/,
    ],
    build(_, match) {
      const token = match.groups?.token?.toUpperCase() ?? '';
      if (!token) return null;
      return singleStep(
        'claw-x-mentions',
        { query: `${token} crypto` },
        'Get X/Twitter sentiment',
        `X sentiment: ${token}`,
      );
    },
  },

  // ── Token holders ─────────────────────────────────────────────────────────
  {
    name: 'token-holders',
    patterns: [
      /^(?:how many\s+)?(?:token\s+)?holders?\s+(?:does\s+|for\s+|of\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})\s+(?:have|has)?[?.]?$/,
      /^(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+(?:holder|holders|holder count|holder distribution)[?.]?$/,
    ],
    build(_, match) {
      const p = tokenParam(match.groups?.token);
      if (!p) return null;
      return singleStep('claw-token-holders', p, 'Get token holders', `Holders: ${match.groups?.token}`);
    },
  },

  // ── Full token analysis (most common complex query) ───────────────────────
  {
    name: 'full-token-analysis',
    patterns: [
      /^(?:full\s+|complete\s+|deep\s+)?(?:analyze|analysis|analyse|breakdown|review)\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})(?:\s+token)?[?.]?$/,
      /^(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+(?:analysis|breakdown|overview|review|due diligence|dd)[?.]?$/,
      /^(?:analyze|analyse|review)\s+(?:the\s+)?token\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20}|[1-9A-HJ-NP-Za-km-z]{32,44})[?.]?$/,
      /^(?:should i (?:buy|hold|sell)|is it worth (?:buying|holding))\s+(?:\$)?(?<token>[A-Za-z0-9]{2,20})[?.]?$/,
    ],
    build(_, match) {
      const p = tokenParam(match.groups?.token);
      if (!p) return null;
      const token = match.groups?.token?.toUpperCase() ?? '';
      return parallelSteps(
        [
          { endpointId: 'claw-token-price', params: p, reason: 'Current price and market data' },
          { endpointId: 'claw-token-risk', params: p, reason: 'Risk score and safety flags' },
          { endpointId: 'claw-token-holders', params: p, reason: 'Holder distribution and whale risk' },
          { endpointId: 'claw-x-mentions', params: { query: `${token} crypto` }, reason: 'Social sentiment' },
        ],
        `Full analysis: ${token}`,
      );
    },
  },

  // ── Wallet full analysis ──────────────────────────────────────────────────
  {
    name: 'wallet-analysis',
    patterns: [
      /^(?:analyze|analyse|review|scan|check)\s+(?:wallet\s+)?(?<wallet>[1-9A-HJ-NP-Za-km-z]{32,44})[?.]?$/,
      /^(?:what(?:'s| is) in|breakdown of)\s+(?:wallet\s+)?(?<wallet>[1-9A-HJ-NP-Za-km-z]{32,44})[?.]?$/,
    ],
    build(_, match) {
      const p = walletParam(match.groups?.wallet);
      if (!p) return null;
      return parallelSteps(
        [
          { endpointId: 'claw-wallet-portfolio', params: p, reason: 'Token holdings and USD values' },
          { endpointId: 'claw-tx-history', params: p, reason: 'Recent transaction history' },
        ],
        `Wallet analysis: ${match.groups?.wallet?.slice(0, 8)}...`,
      );
    },
  },

  // ── News search ───────────────────────────────────────────────────────────
  {
    name: 'news',
    patterns: [
      /^(?:latest\s+|recent\s+|today(?:'s)?\s+)?(?:crypto\s+)?news\s+(?:about|on|for)?\s*(?:\$)?(?<token>[A-Za-z0-9]{2,20})?[?.]?$/,
      /^(?:\$)?(?<token>[A-Za-z0-9]{2,20})\s+(?:latest\s+)?news[?.]?$/,
    ],
    build(_, match) {
      const token = match.groups?.token?.toUpperCase() ?? 'crypto';
      return singleStep(
        'claw-news-search',
        { query: token !== 'CRYPTO' ? `${token} cryptocurrency` : 'solana crypto news' },
        'Search for relevant news',
        `News: ${token}`,
      );
    },
  },

  // ── Fear & greed index ────────────────────────────────────────────────────
  {
    name: 'fear-greed',
    patterns: [
      /^(?:what(?:'s| is)(?: the)? )?(?:crypto\s+)?(?:fear\s+(?:and|&)\s+greed|market\s+sentiment|market\s+mood)(?:\s+index)?(?:\s+(?:right now|today|now))?[?.]?$/,
    ],
    build() {
      return singleStep('coinank-fear-greed', {}, 'Get fear & greed index', 'Crypto fear & greed index');
    },
  },

  // ── Funding rates ─────────────────────────────────────────────────────────
  {
    name: 'funding-rate',
    patterns: [
      /^(?:what(?:'s| is)(?: the)? )?(?:current\s+)?funding\s+rate\s+(?:for\s+)?(?:\$)?(?<token>[A-Za-z0-9]{2,10})?[?.]?$/,
    ],
    build(_, match) {
      const token = match.groups?.token?.toUpperCase() ?? 'BTC';
      return singleStep('coinank-funding-rate', { symbol: token }, 'Get perpetual funding rate', `Funding rate: ${token}`);
    },
  },
];

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Try to match a query against the template registry.
 * Returns a ParsedIntent on match, or null if the query should go to the LLM.
 */
export function matchTemplate(query: string): { intent: ParsedIntent; templateName: string } | null {
  const q = query.toLowerCase().trim().replace(/\s+/g, ' ');

  for (const template of PLAN_TEMPLATES) {
    for (const pattern of template.patterns) {
      const match = q.match(pattern);
      if (match) {
        const intent = template.build(query, match);
        if (intent) {
          return { intent, templateName: template.name };
        }
      }
    }
  }

  return null;
}
